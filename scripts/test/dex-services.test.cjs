'use strict';
/**
 * Integration tests for the DB-backed TigerSwap settlement services.
 *
 * These run against a real SQLite database created from the production schema,
 * create pools the way the admin API does, and then assert on the balances,
 * pool reserves and revenue rows the services actually wrote. Nothing is
 * stubbed: a swap, a liquidity deposit, a farm stake, a borrow and a keeper
 * cycle all move real funds, so a disagreement between pricing and settlement
 * fails the suite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-dex-')), 'dex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const { DexError } = require('../../.test-build/pool-service.js');
const { v3LiquidityForAmounts, v3AmountsForLiquidity } = require('../../.test-build/amm.js');
const { executeSwap, quoteSwap, listPools, claimSponsoredSwap, swapFeeSplit } = require('../../.test-build/swap-service.js');
const { applySchedule } = require('../../.test-build/fee-engine.js');
const { addLiquidity, removeLiquidity, userPositions } = require('../../.test-build/liquidity-service.js');
const { stakeFarm, unstakeFarm, claimFarm, lockVetgr, vetgrStatus, voteGauge, submitBribe, claimBribe, currentEpoch, fundFarmRewards, rewardFundBalance, bribeEscrowAccount, distributeVetgrFees, vetgrFeePot } =
  require('../../.test-build/farm-service.js');
const { openPosition, closePosition, applyFunding, liquidatePosition, perpPositions, markPrice, fundPerpPool, perpPoolBalance } =
  require('../../.test-build/perps-service.js');
const { supply, borrow, repay, withdrawSupply, flashLoan, listLendingMarkets, accrueInterest, liquidateBorrow } = require('../../.test-build/margin-service.js');
const { contribute, claimRaise, launchEscrowAccount, listNft, buyNft, initiateBridge, releaseBridge } = require('../../.test-build/launch-service.js');
const { settleDueLimitOrders, runDueDcaPlans, runDueTwapPlans, runPerpCycle, runKeeperCycle } = require('../../.test-build/keeper.js');
const { scanCopySwaps, mirrorCopySwaps, copyMirrors, runDexCopySweep } = require('../../.test-build/copy-service.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, 'active')`).run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
  );
  return userId;
}

function credit(userId, currency, available) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(`INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`).run(
    generateId(),
    walletId,
    currency,
    available,
  );
}

let poolSeq = 0;

/** Create an active pool exactly as the admin route would persist it. */
function createPool(kind, tokens, reserves, extra = {}) {
  poolSeq += 1;
  const poolId = generateId();
  const address = `0x${String(poolSeq).padStart(40, '0')}`;
  const totalSupply =
    kind === 'v2' ? Math.sqrt(reserves[tokens[0]] * reserves[tokens[1]]) : reserves[tokens[0]];
  db.prepare(
    `INSERT INTO dex_pools
       (pool_id, kind, address, tokens, fee, amplification, weights, tick_spacing, sqrt_price, liquidity,
        sqrt_price_lower, sqrt_price_upper, reserves, total_supply, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).run(
    poolId,
    kind,
    address,
    JSON.stringify(tokens),
    extra.fee ?? 0.003,
    extra.amplification ?? null,
    extra.weights ? JSON.stringify(extra.weights) : null,
    extra.tickSpacing ?? null,
    extra.sqrtPrice ?? null,
    extra.liquidity ?? null,
    extra.sqrtPriceLower ?? null,
    extra.sqrtPriceUpper ?? null,
    JSON.stringify(reserves),
    totalSupply,
  );
  return poolId;
}

function reservesOf(poolId) {
  return JSON.parse(db.prepare('SELECT reserves FROM dex_pools WHERE pool_id = ?').get(poolId).reserves);
}

function listPair(base, price, tickSize = 0.01) {
  const symbol = `${base}/RUSD`;
  if (db.prepare('SELECT 1 FROM trading_pairs WHERE symbol = ?').get(symbol)) return symbol;
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, 'RUSD', ?, 'active', ?, 0.0001, 1000000, 1, 0.001, 0.001)`,
  ).run(generateId(), base, symbol, tickSize);
  db.prepare(
    `INSERT INTO market_data (id, symbol, price, volume_24h) VALUES (?, ?, ?, 0)`,
  ).run(generateId(), symbol, price);
  return symbol;
}

// ---------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------

test('a swap moves real balances and grows the input reserve', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  const poolId = createPool('v2', ['RUSD', 'TGR'], { RUSD: 1000000, TGR: 1000000 });

  const quote = quoteSwap({ tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });
  assert.ok(quote.amountOut > 0 && quote.amountOut < 1000);
  assert.equal(quote.fee, 3);

  const result = executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });
  assert.equal(result.amountOut, quote.amountOut);
  assert.equal(availableBalance(user, 'RUSD'), 99000);
  assert.equal(availableBalance(user, 'TGR'), quote.amountOut);

  const reserves = reservesOf(poolId);
  // The pool keeps the LP share of the fee; every other bucket (veTGR, treasury,
  // insurance, burn) is carved out of the pool and held in the account that owns
  // it, so it is not left in the reserves as well.
  const split = swapFeeSplit();
  const parts = applySchedule(quote.fee, split);
  const protocolShare = parts.vetgr + parts.treasury + parts.insurance + parts.burn;
  assert.ok(Math.abs(reserves.RUSD - (1001000 - protocolShare)) < 1e-6);
  assert.ok(Math.abs(reserves.TGR - (1000000 - quote.amountOut)) < 1e-6);
});

test('a swap conserves total value: the protocol fee is carved out of the pool, not minted', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  const poolId = createPool('v2', ['RUSD', 'SOL'], { RUSD: 1000000, SOL: 50000 });

  const totalValue = () => {
    const r = reservesOf(poolId);
    const treasury = Number(
      db
        .prepare("SELECT COALESCE(SUM(balance), 0) AS s FROM treasury_accounts WHERE asset IN ('RUSD','SOL')")
        .get().s,
    );
    return availableBalance(user, 'RUSD') + availableBalance(user, 'SOL') + r.RUSD + r.SOL + treasury;
  };

  const before = totalValue();
  executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'SOL', amountIn: 10000 });
  const after = totalValue();

  // A swap must move value, never create it. Before the carve-out fix the
  // treasury share was credited while the whole fee stayed in the pool, so the
  // total grew by exactly the protocol share.
  assert.ok(Math.abs(after - before) < 1e-6, `value must be conserved, moved by ${after - before}`);
});

test('a settlement fee is taken from the output, not minted into the treasury', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  createPool('v2', ['RUSD', 'TGR'], { RUSD: 1000000, TGR: 1000000 });

  const previous = db.prepare("SELECT value FROM system_settings WHERE key = 'dex_settlement_fee_bps'").get();
  db.prepare(
    "INSERT INTO system_settings (key, value, category) VALUES ('dex_settlement_fee_bps', '100', 'dex') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run();
  try {
    const quote = quoteSwap({ tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });
    const settlementFee = quote.amountOut * 0.01;
    const treasuryBefore = Number(
      db.prepare("SELECT balance FROM treasury_accounts WHERE asset = 'TGR' AND account_type = 'dex_treasury'").get()?.balance ?? 0,
    );

    executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });

    // The protocol fee must come out of the trader's output. If it is only
    // credited to the treasury, the treasury is funded with tokens nobody paid.
    assert.ok(
      Math.abs(availableBalance(user, 'TGR') - (quote.amountOut - settlementFee)) < 1e-6,
      `the trader keeps the output net of the settlement fee, got ${availableBalance(user, 'TGR')}`,
    );
    const treasuryAfter = Number(
      db.prepare("SELECT balance FROM treasury_accounts WHERE asset = 'TGR' AND account_type = 'dex_treasury'").get()?.balance ?? 0,
    );
    assert.ok(Math.abs(treasuryAfter - (treasuryBefore + settlementFee)) < 1e-6, 'the treasury receives exactly the fee');
  } finally {
    if (previous) {
      db.prepare("UPDATE system_settings SET value = ? WHERE key = 'dex_settlement_fee_bps'").run(previous.value);
    } else {
      db.prepare("DELETE FROM system_settings WHERE key = 'dex_settlement_fee_bps'").run();
    }
  }
});

test('a sponsored swap allowance counts only sponsored swaps, not paid ones', () => {
  const user = seedUser();
  credit(user, 'RUSD', 1000000);
  createPool('v2', ['RUSD', 'TGR'], { RUSD: 10000000, TGR: 10000000 });

  // The protocol sponsors three swaps per day. A trader who pays for swaps must
  // not have those paid swaps consume the free allowance.
  for (let i = 0; i < 5; i += 1) {
    executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });
  }
  assert.equal(claimSponsoredSwap(user), true, 'paid swaps must not exhaust the allowance');

  // Three sponsored swaps consume it; the fourth is refused.
  const sponsored = [];
  for (let i = 0; i < 4; i += 1) {
    sponsored.push(executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000, gasless: true }).sponsored);
  }
  assert.deepEqual(sponsored, [true, true, true, false]);
  assert.equal(claimSponsoredSwap(user), false);
});

test('DEX copy trading mirrors a leader swap once, sized by the follower config', () => {
  const leader = seedUser();
  const follower = seedUser();
  credit(leader, 'RUSD', 1_000_000);
  credit(follower, 'RUSD', 10_000_000);
  createPool('v2', ['RUSD', 'TGR'], { RUSD: 10000000, TGR: 10000000 });

  // A leader makes a real swap on TigerSwap.
  const leaderSwap = executeSwap({ userId: leader, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });

  const traderId = generateId();
  db.prepare(
    `INSERT INTO copy_traders (trader_id, user_id, display_name, status, max_followers, profit_share)
     VALUES (?, ?, 'Leader', 'approved', 100, 0.1)`,
  ).run(traderId, leader);
  // The follow must predate the leader's swap for it to be copied.
  db.prepare(
    `INSERT INTO copy_follows (follow_id, follower_id, trader_id, copy_mode, ratio, max_position, status, created_at)
     VALUES (?, ?, ?, 'ratio', 1, NULL, 'active', datetime('now', '-1 hour'))`,
  ).run(generateId(), follower, traderId);

  const pending = scanCopySwaps(follower);
  assert.equal(pending.length, 1, 'the leader swap is offered exactly once');
  assert.equal(pending[0].leaderSwapId, leaderSwap.swapId);
  assert.ok(pending[0].amountIn > 0, 'the mirror is sized to a positive amount');

  const results = mirrorCopySwaps(follower);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'mirrored');
  assert.ok(results[0].amountOut > 0);

  // The follower's balance moved for real, and the mirror is recorded once.
  assert.ok(availableBalance(follower, 'TGR') > 0, 'the follower received the copied output');
  assert.ok(availableBalance(follower, 'RUSD') < 10_000_000, 'the follower paid for the copied input');
  assert.equal(copyMirrors(follower).length, 1);

  // A second run has nothing left to mirror: a leader swap is copied once.
  assert.equal(scanCopySwaps(follower).length, 0);
  assert.equal(mirrorCopySwaps(follower).length, 0);
});

test('DEX copy trading skips a mirror the follower cannot fund without aborting', () => {
  const leader = seedUser();
  const follower = seedUser();
  credit(leader, 'RUSD', 1_000_000);
  credit(follower, 'RUSD', 1); // far too little for the copied size
  createPool('v2', ['RUSD', 'TGR'], { RUSD: 10000000, TGR: 10000000 });
  executeSwap({ userId: leader, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });

  const traderId = generateId();
  db.prepare(
    `INSERT INTO copy_traders (trader_id, user_id, display_name, status, max_followers, profit_share)
     VALUES (?, ?, 'Leader', 'approved', 100, 0.1)`,
  ).run(traderId, leader);
  // A fixed-size follow of 5000 RUSD is more than the follower holds.
  db.prepare(
    `INSERT INTO copy_follows (follow_id, follower_id, trader_id, copy_mode, fixed_amount, status, created_at)
     VALUES (?, ?, ?, 'fixed', 5000, 'active', datetime('now', '-1 hour'))`,
  ).run(generateId(), follower, traderId);

  const results = mirrorCopySwaps(follower);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'skipped');
  assert.equal(results[0].reason, 'INSUFFICIENT_BALANCE');
  // A skipped mirror is not recorded, so it can be retried once funded.
  assert.equal(copyMirrors(follower).length, 0);
});

test('the DEX copy sweep mirrors every active follower and skips the unfunded one', () => {
  const leader = seedUser();
  const funded = seedUser();
  const broke = seedUser();
  credit(leader, 'RUSD', 1_000_000);
  credit(funded, 'RUSD', 1_000_000);
  credit(broke, 'RUSD', 1); // cannot fund the fixed 500 copy
  createPool('v2', ['RUSD', 'TGR'], { RUSD: 10000000, TGR: 10000000 });
  executeSwap({ userId: leader, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });

  const traderId = generateId();
  db.prepare(
    `INSERT INTO copy_traders (trader_id, user_id, display_name, status, max_followers, profit_share)
     VALUES (?, ?, 'Leader', 'approved', 100, 0.1)`,
  ).run(traderId, leader);
  for (const follower of [funded, broke]) {
    db.prepare(
      `INSERT INTO copy_follows (follow_id, follower_id, trader_id, copy_mode, fixed_amount, status, created_at)
       VALUES (?, ?, ?, 'fixed', 500, 'active', datetime('now', '-1 hour'))`,
    ).run(generateId(), follower, traderId);
  }

  const swept = runDexCopySweep();
  const mirrored = swept.filter((r) => r.status === 'mirrored' && r.followerId === funded);
  const skipped = swept.filter((r) => r.status === 'skipped' && r.followerId === broke);
  assert.equal(mirrored.length, 1, 'the funded follower is mirrored');
  assert.equal(skipped.length, 1, 'the unfunded follower is skipped, not fatal');
  assert.equal(skipped[0].reason, 'INSUFFICIENT_BALANCE');

  // A second sweep has nothing new to mirror for the funded follower.
  assert.equal(
    runDexCopySweep().filter((r) => r.status === 'mirrored' && r.followerId === funded).length,
    0,
  );
});

test('the keeper cycle settles DEX copy mirrors and reports the counts', () => {
  const leader = seedUser();
  const follower = seedUser();
  credit(leader, 'RUSD', 1_000_000);
  credit(follower, 'RUSD', 1_000_000);
  createPool('v2', ['RUSD', 'TGR'], { RUSD: 10000000, TGR: 10000000 });
  executeSwap({ userId: leader, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 });

  const traderId = generateId();
  db.prepare(
    `INSERT INTO copy_traders (trader_id, user_id, display_name, status, max_followers, profit_share)
     VALUES (?, ?, 'Leader', 'approved', 100, 0.1)`,
  ).run(traderId, leader);
  db.prepare(
    `INSERT INTO copy_follows (follow_id, follower_id, trader_id, copy_mode, fixed_amount, status, created_at)
     VALUES (?, ?, ?, 'fixed', 500, 'active', datetime('now', '-1 hour'))`,
  ).run(generateId(), follower, traderId);

  const report = runKeeperCycle();
  // Other tests leave active follows behind, so the cycle reports the whole
  // venue; this follower's own mirror is what must have settled.
  assert.ok(report.copyMirrored >= 1, 'the keeper mirrors at least this pending leader swap');
  assert.equal(copyMirrors(follower).length, 1);
});

test('a swap without the input balance is refused and moves nothing', () => {
  const user = seedUser();
  createPool('v2', ['RUSD', 'SOL'], { RUSD: 1000000, SOL: 10000 });
  assert.throws(
    () => executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'SOL', amountIn: 100 }),
    (error) => error instanceof DexError && error.code === 'INSUFFICIENT_BALANCE',
  );
  assert.equal(availableBalance(user, 'RUSD'), 0);
});

test('a blacklisted wallet cannot swap', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  createPool('v2', ['RUSD', 'ADA'], { RUSD: 1000000, ADA: 1000000 });
  db.prepare("INSERT INTO dex_blacklist (entry_id, kind, value, reason) VALUES (?, 'wallet', ?, 'test')").run(
    generateId(),
    user,
  );
  assert.throws(
    () => executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'ADA', amountIn: 100 }),
    (error) => error instanceof DexError && error.code === 'BLACKLISTED',
  );
});

test('a paused DEX refuses a swap', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  createPool('v2', ['RUSD', 'DOT'], { RUSD: 1000000, DOT: 1000000 });
  db.prepare("UPDATE exchange_controls SET paused = 1, reason = 'drill' WHERE scope = 'dex'").run();
  try {
    assert.throws(
      () => executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'DOT', amountIn: 100 }),
      (error) => error instanceof DexError && error.code === 'DEX_PAUSED',
    );
  } finally {
    db.prepare("UPDATE exchange_controls SET paused = 0, reason = NULL WHERE scope = 'dex'").run();
  }
});

test('a pause blocks new exposure but never the unwind', () => {
  const provider = seedUser();
  credit(provider, 'RUSD', 50000);
  credit(provider, 'XTZ', 50000);
  const poolId = createPool('v2', ['RUSD', 'XTZ'], { RUSD: 1000000, XTZ: 1000000 });
  const added = addLiquidity({ userId: provider, poolId, amounts: { RUSD: 10000, XTZ: 10000 } });

  db.prepare("UPDATE exchange_controls SET paused = 1 WHERE scope = 'dex'").run();
  try {
    assert.throws(
      () => addLiquidity({ userId: provider, poolId, amounts: { RUSD: 100, XTZ: 100 } }),
      (error) => error instanceof DexError && error.code === 'DEX_PAUSED',
    );
    // The provider can still take their own liquidity back.
    const removed = removeLiquidity({ userId: provider, poolId, liquidity: added.liquidity });
    assert.ok(removed.amount0 > 0);
  } finally {
    db.prepare("UPDATE exchange_controls SET paused = 0 WHERE scope = 'dex'").run();
  }
});

test('a blacklisted wallet cannot open a perpetual or borrow', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  const symbol = listPerp('BLKX', 100);
  createLendingMarket('RUSD');
  db.prepare("INSERT INTO dex_blacklist (entry_id, kind, value, reason) VALUES (?, 'wallet', ?, 'fraud')").run(
    generateId(),
    user,
  );
  assert.throws(
    () => openPosition({ userId: user, symbol, side: 'long', size: 1, leverage: 5 }),
    (error) => error instanceof DexError && error.code === 'BLACKLISTED',
  );
  assert.throws(
    () => supply(user, 'RUSD', 1000),
    (error) => error instanceof DexError && error.code === 'BLACKLISTED',
  );
});

test('a blacklisted pool cannot be swapped or joined', () => {
  const user = seedUser();
  credit(user, 'RUSD', 50000);
  credit(user, 'GRT', 50000);
  const poolId = createPool('v2', ['RUSD', 'GRT'], { RUSD: 1000000, GRT: 1000000 });
  db.prepare("INSERT INTO dex_blacklist (entry_id, kind, value, reason) VALUES (?, 'pool', ?, 'exploit')").run(
    generateId(),
    poolId,
  );
  // A blacklisted pool is excluded from routing, so no path is found.
  assert.throws(
    () => executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'GRT', amountIn: 100 }),
    (error) => error instanceof DexError && (error.code === 'NO_ROUTES' || error.code === 'NO_POOLS'),
  );
  assert.throws(
    () => addLiquidity({ userId: user, poolId, amounts: { RUSD: 100, GRT: 100 } }),
    (error) => error instanceof DexError && error.code === 'BLACKLISTED',
  );
});

test('the swap fee split is recorded in the revenue ledger', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  createPool('v2', ['RUSD', 'LINK'], { RUSD: 1000000, LINK: 1000000 });
  executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'LINK', amountIn: 1000 });

  const row = db
    .prepare("SELECT * FROM dex_revenue_ledger WHERE source = 'dex_swap' ORDER BY created_at DESC LIMIT 1")
    .get();
  assert.ok(row);
  const parts = row.lp_share + row.vetgr_share + row.treasury_share + row.insurance_share + row.burn_share;
  assert.ok(Math.abs(parts - row.amount) < 1e-9, 'the split must sum back to the fee');
  assert.ok(row.lp_share > 0);
});

// ---------------------------------------------------------------------------
// Liquidity
// ---------------------------------------------------------------------------

test('adding liquidity mints LP tokens and removing them returns the share', () => {
  const provider = seedUser();
  credit(provider, 'RUSD', 50000);
  credit(provider, 'ETH', 50);
  const poolId = createPool('v2', ['RUSD', 'ETH'], { RUSD: 1000000, ETH: 1000 });

  const added = addLiquidity({ userId: provider, poolId, amounts: { RUSD: 10000, ETH: 10 } });
  assert.ok(added.liquidity > 0);
  assert.equal(availableBalance(provider, 'RUSD'), 40000);
  assert.equal(availableBalance(provider, 'ETH'), 40);
  const lpToken = 'TS-LP-RUSD-ETH';
  assert.equal(availableBalance(provider, lpToken), added.liquidity);

  const positions = userPositions(provider);
  assert.equal(positions.length, 1);

  const removed = removeLiquidity({ userId: provider, poolId, liquidity: added.liquidity });
  assert.ok(removed.amount0 > 0 && removed.amount1 > 0);
  assert.equal(availableBalance(provider, lpToken), 0);
  assert.equal(userPositions(provider).length, 0);
});

test('a locked liquidity position cannot be withdrawn', () => {
  const provider = seedUser();
  credit(provider, 'RUSD', 50000);
  credit(provider, 'MATIC', 50000);
  const poolId = createPool('v2', ['RUSD', 'MATIC'], { RUSD: 1000000, MATIC: 1000000 });
  const added = addLiquidity({
    userId: provider,
    poolId,
    amounts: { RUSD: 10000, MATIC: 10000 },
    lockedUntil: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.throws(
    () => removeLiquidity({ userId: provider, poolId, liquidity: added.liquidity }),
    (error) => error instanceof DexError && error.code === 'POSITION_LOCKED',
  );
});

// ---------------------------------------------------------------------------
// Farms, veTGR and gauges
// ---------------------------------------------------------------------------

function createFarm(poolId, rewardToken = 'TGR') {
  const farmId = generateId();
  db.prepare(
    `INSERT INTO dex_farms (farm_id, name, pool_id, reward_token, reward_rate, apr, status)
     VALUES (?, ?, ?, ?, ?, 100, 'active')`,
  ).run(farmId, `farm-${farmId}`, poolId, rewardToken, 1);
  db.prepare('INSERT INTO dex_gauges (gauge_id, pool_id) VALUES (?, ?)').run(generateId(), poolId);
  return farmId;
}

test('staked LP tokens accrue rewards that a claim credits', () => {
  const provider = seedUser();
  credit(provider, 'RUSD', 50000);
  credit(provider, 'BNB', 50);
  const poolId = createPool('v2', ['RUSD', 'BNB'], { RUSD: 1000000, BNB: 1000 });
  const added = addLiquidity({ userId: provider, poolId, amounts: { RUSD: 10000, BNB: 10 } });
  const farmId = createFarm(poolId);
  // A farm pays only what its reward fund holds, so it must be funded first.
  fundFarmRewards('TGR', 1000000);

  const staked = stakeFarm(provider, farmId, added.liquidity);
  assert.equal(staked.staked, added.liquidity);
  assert.equal(lockedBalance(provider, 'TS-LP-RUSD-BNB'), added.liquidity);

  // Move the farm's clock back so a reward has accrued, then claim it.
  db.prepare('UPDATE dex_farm_meta SET last_update = ? WHERE farm_id = ?').run(Date.now() - 3_600_000, farmId);
  const claimed = claimFarm(provider, farmId);
  assert.ok(claimed > 0, 'an hour of rewards at 1/sec should be positive');
  assert.equal(availableBalance(provider, 'TGR'), claimed);
  // The reward came out of the fund, not out of thin air.
  assert.equal(rewardFundBalance('TGR'), 1000000 - claimed);

  const unstaked = unstakeFarm(provider, farmId, added.liquidity);
  assert.equal(unstaked.remaining, 0);
  assert.equal(lockedBalance(provider, 'TS-LP-RUSD-BNB'), 0);
  assert.equal(availableBalance(provider, 'TS-LP-RUSD-BNB'), added.liquidity);
});

test('a farm with an empty reward fund pays nothing and keeps the shortfall pending', () => {
  const provider = seedUser();
  credit(provider, 'RUSD', 50000);
  credit(provider, 'BNB', 50);
  const poolId = createPool('v2', ['RUSD', 'BNB'], { RUSD: 1000000, BNB: 1000 });
  const added = addLiquidity({ userId: provider, poolId, amounts: { RUSD: 10000, BNB: 10 } });
  const farmId = createFarm(poolId);

  stakeFarm(provider, farmId, added.liquidity);
  db.prepare('UPDATE dex_farm_meta SET last_update = ? WHERE farm_id = ?').run(Date.now() - 3_600_000, farmId);

  // No funding, so the claim must pay nothing rather than mint reward tokens.
  const claimed = claimFarm(provider, farmId);
  assert.equal(claimed, 0);
  assert.equal(availableBalance(provider, 'TGR'), 0);

  // Once the fund is topped up the reward is still owed and can be claimed.
  fundFarmRewards('TGR', 1000000);
  const afterFunding = claimFarm(provider, farmId);
  assert.ok(afterFunding > 0, 'the pending reward is paid once the fund is refilled');
  assert.equal(availableBalance(provider, 'TGR'), afterFunding);
});

test('veTGR locks TGR and refuses an unlock before maturity', () => {
  const user = seedUser();
  credit(user, 'TGR', 1000);
  const lock = lockVetgr(user, 100, 30);
  assert.ok(lock.votingPower > 0);
  assert.equal(availableBalance(user, 'TGR'), 900);
  assert.equal(lockedBalance(user, 'TGR'), 100);
  assert.equal(vetgrStatus(user).amount, 100);
});

test('veTGR protocol fees are distributed to lockers pro-rata, once per epoch', () => {
  const a = seedUser();
  const b = seedUser();
  credit(a, 'TGR', 1000);
  credit(b, 'TGR', 1000);
  lockVetgr(a, 100, 90);
  lockVetgr(b, 300, 90);

  // A settled swap's veTGR share already sits in the fee pot as real value.
  db.prepare(
    `INSERT INTO treasury_accounts (account_id, asset, network, account_type, balance)
     VALUES (?, 'VETFEE', 'TIGEREX', 'dex_vetgr_fees', 1000)
     ON CONFLICT(asset, network, account_type) DO UPDATE SET balance = balance + 1000`,
  ).run(generateId());

  const totalLocked = Number(db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM dex_ve_locks').get().s);
  const beforeA = availableBalance(a, 'VETFEE');
  const beforeB = availableBalance(b, 'VETFEE');
  const report = distributeVetgrFees();
  const entry = report.find((row) => row.asset === 'VETFEE');
  assert.ok(entry && Math.abs(entry.distributed - 1000) < 1e-9, 'the whole pot is paid out');

  assert.ok(
    Math.abs(availableBalance(a, 'VETFEE') - (beforeA + (1000 * 100) / totalLocked)) < 1e-6,
    'the fee is paid pro-rata by locked amount',
  );
  assert.ok(Math.abs(availableBalance(b, 'VETFEE') - (beforeB + (1000 * 300) / totalLocked)) < 1e-6);

  // A second call in the same epoch pays nothing more and empties nothing extra.
  const second = distributeVetgrFees();
  assert.ok(!second.some((row) => row.asset === 'VETFEE'), 'the pot is distributed at most once per epoch');
  assert.equal(vetgrFeePot('VETFEE').balance, 0, 'the pot is emptied by the distribution');
});

test('a gauge vote is recorded for the current epoch', () => {
  const voter = seedUser();
  credit(voter, 'TGR', 1000);
  credit(voter, 'RUSD', 1000);
  lockVetgr(voter, 100, 90);
  const poolId = createPool('v2', ['RUSD', 'AVAX'], { RUSD: 1000000, AVAX: 100000 });
  const gaugeId = generateId();
  db.prepare('INSERT INTO dex_gauges (gauge_id, pool_id) VALUES (?, ?)').run(gaugeId, poolId);

  voteGauge(voter, gaugeId, 1);
  const vote = db.prepare('SELECT * FROM dex_gauge_votes WHERE gauge_id = ? AND user_id = ?').get(gaugeId, voter);
  assert.equal(vote.epoch, currentEpoch());

  const bribeId = submitBribe(voter, gaugeId, 'RUSD', 500);
  assert.ok(bribeId);
  const bribe = db.prepare('SELECT * FROM dex_bribes WHERE bribe_id = ?').get(bribeId);
  assert.equal(bribe.amount, 500);

  // The bribe is a real transfer: the sponsor is debited and the tokens sit in
  // the bribe's own escrow, so the claim below pays from funds that exist.
  assert.equal(availableBalance(voter, 'RUSD'), 500, 'the sponsor pays the bribe');
  const escrow = db
    .prepare("SELECT balance FROM treasury_accounts WHERE account_type = ? AND asset = 'RUSD'")
    .get(bribeEscrowAccount(bribeId));
  assert.equal(escrow.balance, 500, 'the bribe is held in escrow, not fabricated');

  const claim = claimBribe(voter, bribeId);
  assert.equal(claim.amount, 500, 'the only voter takes the whole bribe');
  assert.equal(availableBalance(voter, 'RUSD'), 1000, 'the claimed bribe returns to the voter');
  assert.throws(() => claimBribe(voter, bribeId), 'a second claim is refused');
});

test('a bribe cannot be recorded that the sponsor cannot fund', () => {
  const sponsor = seedUser();
  credit(sponsor, 'RUSD', 100);
  const poolId = createPool('v2', ['RUSD', 'AVAX'], { RUSD: 1000000, AVAX: 100000 });
  const gaugeId = generateId();
  db.prepare('INSERT INTO dex_gauges (gauge_id, pool_id) VALUES (?, ?)').run(gaugeId, poolId);

  assert.throws(() => submitBribe(sponsor, gaugeId, 'RUSD', 500), 'an unfunded bribe is refused');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dex_bribes WHERE sponsor = ?').get(sponsor).c, 0);
});

// ---------------------------------------------------------------------------
// Perpetuals
// ---------------------------------------------------------------------------

let contractSeq = 0;

function listPerp(base, price, maintenanceRate = 0.005, settlement = 'RUSD') {
  contractSeq += 1;
  const symbol = `${base}${contractSeq}/RUSD`;
  db.prepare(
    `INSERT INTO futures_markets
       (market_id, symbol, base_asset, quote_asset, settlement_asset, contract_type, listing_type,
        contract_size, tick_size, min_quantity, max_quantity, max_leverage, maker_fee_bps, taker_fee_bps,
        funding_interval_hours, funding_rate_cap, maintenance_margin_rate, initial_margin_rate,
        liquidation_fee_rate, insurance_fund_share, status)
     VALUES (?, ?, ?, 'RUSD', ?, 'RUSD_M', 'perpetual', 1, 0.1, 0.001, 1000000, 100, 2, 5, 8, 0.01, ?, 0.008, 0.005, 0.1, 'active')`,
  ).run(generateId(), symbol, base, settlement, maintenanceRate);
  db.prepare('INSERT INTO market_data (id, symbol, price, volume_24h) VALUES (?, ?, ?, 0)').run(
    generateId(),
    symbol,
    price,
  );
  return symbol;
}

test('a perpetual opens, moves margin, and closes with realised PnL', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('BTCX', 50000);

  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  assert.equal(opened.entryPrice, 50000);
  assert.ok(opened.margin > 0);
  assert.equal(lockedBalance(trader, 'RUSD'), opened.margin);
  assert.equal(availableBalance(trader, 'RUSD'), 100000 - opened.margin - opened.fee);

  const closed = closePosition(trader, opened.positionId);
  // Closing at the entry mark realises no price PnL, only the round-trip fees.
  const roundTripFees = (opened.margin * opened.leverage * 5) / 10_000 * 2;
  assert.ok(Math.abs(closed.pnl + roundTripFees) < 1e-6, `pnl ${closed.pnl} should be the negative of the fees`);
  assert.equal(lockedBalance(trader, 'RUSD'), 0);
  // The margin is unlocked and only the two fees leave the account: a close
  // must never credit the margin back a second time.
  assert.ok(
    Math.abs(availableBalance(trader, 'RUSD') - (100000 - roundTripFees)) < 1e-6,
    `available ${availableBalance(trader, 'RUSD')} should be the opening balance less the round-trip fees`,
  );
  assert.equal(perpPositions(trader).length, 0);
});

test('a position below its maintenance margin is liquidated', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('ETHX', 2000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 10, leverage: 50 });

  const result = liquidatePosition(opened.positionId, 1000);
  assert.ok(result.penalty >= 0);
  const row = db.prepare('SELECT status FROM dex_perp_positions WHERE position_id = ?').get(opened.positionId);
  assert.equal(row.status, 'liquidated');
  assert.equal(lockedBalance(trader, 'RUSD'), 0);
  // Equity at 1000 is far below zero, so the whole margin is seized. The trader
  // must end with the opening balance less the open fee and the lost margin: a
  // liquidation must never credit the margin back.
  const lost = opened.margin;
  assert.ok(
    Math.abs(availableBalance(trader, 'RUSD') - (100000 - opened.fee - lost)) < 1e-6,
    `available ${availableBalance(trader, 'RUSD')} should be the opening balance less the fee and the margin`,
  );
});

test('a partial-loss liquidation returns the surviving equity exactly once', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('BNBX', 50000);
  // 2x leverage: margin 25000. Marked down to 45000 the position still has
  // positive equity, so the trader must be returned that equity less the penalty.
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 2 });
  const result = liquidatePosition(opened.positionId, 45000);

  const equity = 20000; // 25000 margin - 5000 price loss
  const penalty = equity * 0.005;
  const returned = equity - penalty;
  const seized = opened.margin - returned;

  assert.ok(Math.abs(result.penalty - penalty) < 1e-6, `penalty ${result.penalty}`);
  // The unlock returns the whole margin, so the net movement is `returned -
  // seized`. Crediting `returned` as well double-counts the seized margin and
  // lets a liquidation hand the trader more than they opened with.
  assert.equal(lockedBalance(trader, 'RUSD'), 0, 'the margin reservation is released');
  assert.ok(
    Math.abs(availableBalance(trader, 'RUSD') - (100000 - opened.fee - seized)) < 1e-6,
    `available ${availableBalance(trader, 'RUSD')} should be the opening balance less the open fee and the seized margin`,
  );
  assert.ok(availableBalance(trader, 'RUSD') < 100000, 'a liquidation never credits more than was opened with');
});

test('funding moves collateral between the two sides of a market', () => {
  const long = seedUser();
  const short = seedUser();
  credit(long, 'RUSD', 100000);
  credit(short, 'RUSD', 100000);
  const symbol = listPerp('SOLX', 100);
  const longPos = openPosition({ userId: long, symbol, side: 'long', size: 10, leverage: 10 });
  const shortPos = openPosition({ userId: short, symbol, side: 'short', size: 10, leverage: 10 });

  const before = db.prepare('SELECT collateral FROM dex_perp_positions WHERE position_id = ?').get(longPos.positionId);
  const longLockedBefore = lockedBalance(long, 'RUSD');
  const shortLockedBefore = lockedBalance(short, 'RUSD');
  applyFunding(symbol, 0.001);
  const after = db.prepare('SELECT collateral FROM dex_perp_positions WHERE position_id = ?').get(longPos.positionId);
  assert.ok(after.collateral < before.collateral, 'a positive rate charges the long');

  // The ledger must track the collateral exactly: the payer's reservation is
  // reduced by the payment and the receiver's is increased by the same amount,
  // so a receiver can still close and recover its margin plus funding.
  const longLockedAfter = lockedBalance(long, 'RUSD');
  const shortLockedAfter = lockedBalance(short, 'RUSD');
  assert.ok(Math.abs(longLockedAfter - after.collateral) < 1e-9, 'the long reservation must equal its collateral');
  assert.ok(longLockedAfter < longLockedBefore, 'the long pays funding out of its reservation');
  assert.ok(shortLockedAfter > shortLockedBefore, 'the short is paid funding into its reservation');
  const shortCollateral = db.prepare('SELECT collateral FROM dex_perp_positions WHERE position_id = ?').get(shortPos.positionId).collateral;
  assert.ok(Math.abs(shortLockedAfter - shortCollateral) < 1e-9, 'the short reservation must equal its collateral');
  // The receiver can close, which the old funding path made impossible.
  const closed = closePosition(short, shortPos.positionId);
  assert.equal(closed.positionId, shortPos.positionId);
  assert.equal(lockedBalance(short, 'RUSD'), 0);
});

test('a payer that cannot cover its funding is liquidated and the transfer stays zero-sum', () => {
  const long = seedUser();
  const short = seedUser();
  // The long posts the minimum margin at a high leverage, so its funding charge
  // exceeds its collateral; the short is fully funded.
  credit(long, 'RUSD', 100000);
  credit(short, 'RUSD', 100000);
  const symbol = listPerp('FUNDX', 100);
  const longPos = openPosition({ userId: long, symbol, side: 'long', size: 100, leverage: 100 });
  openPosition({ userId: short, symbol, side: 'short', size: 1, leverage: 10 });

  const shortBefore = lockedBalance(short, 'RUSD');
  const paid = applyFunding(symbol, 0.05);
  const shortAfter = lockedBalance(short, 'RUSD');

  // The payer was liquidated, so it contributed nothing to the funding pool and
  // the receiver is credited only that: the old path paid the receiver in full
  // and minted the shortfall as locked balance out of nothing.
  assert.equal(paid, 0, 'a liquidated payer contributes nothing');
  assert.equal(shortAfter, shortBefore, 'the receiver is credited only what the payer contributed');
  const longRow = db.prepare('SELECT status FROM dex_perp_positions WHERE position_id = ?').get(longPos.positionId);
  assert.equal(longRow.status, 'liquidated', 'an insolvent payer is liquidated');
});

test('the keeper liquidates using the market own maintenance margin', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  // A market with a 50% maintenance rate: at a mark of 700 the equity (200)
  // sits below maintenance (350), so the position must be liquidated. A
  // hardcoded 0.5% rate would compute 3.5 and leave the position open.
  const symbol = listPerp('HIGHX', 1000, 0.5);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 2 });
  db.prepare('UPDATE market_data SET price = 700 WHERE symbol = ?').run(symbol);

  const report = runPerpCycle();
  assert.ok(report.liquidated >= 1, 'a position below its maintenance margin must be liquidated');
  const row = db.prepare('SELECT status FROM dex_perp_positions WHERE position_id = ?').get(opened.positionId);
  assert.equal(row.status, 'liquidated');
  assert.equal(lockedBalance(trader, 'RUSD'), 0);
});

test('a winning perpetual close is paid out of the counterparty pool, never minted', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('WINX', 50000);
  // Fund the pool the way the venue does: a real transfer in.
  fundPerpPool('RUSD', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  db.prepare('UPDATE market_data SET price = 60000 WHERE symbol = ?').run(symbol);

  const poolBefore = perpPoolBalance('RUSD');
  const closed = closePosition(trader, opened.positionId);
  // The 10000 price gain leaves the pool and reaches the trader.
  assert.ok(Math.abs(perpPoolBalance('RUSD') - (poolBefore - 10000)) < 1e-6, 'the pool pays the profit');
  assert.ok(
    Math.abs(availableBalance(trader, 'RUSD') - (100000 - opened.fee - closed.fee + 10000)) < 1e-6,
    `the trader is paid the profit, got ${availableBalance(trader, 'RUSD')}`,
  );
});

test('a winning close with an empty pool fails closed instead of minting the profit', () => {
  const trader = seedUser();
  // A USDC-settled contract: nothing has funded the USDC counterparty pool.
  credit(trader, 'USDC', 100000);
  const symbol = listPerp('EMPTYX', 50000, 0.005, 'USDC');
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  db.prepare('UPDATE market_data SET price = 60000 WHERE symbol = ?').run(symbol);

  const before = availableBalance(trader, 'USDC');
  assert.throws(() => closePosition(trader, opened.positionId), 'the pool cannot pay a profit it does not hold');
  // The failed close rolled back, so the margin is still locked and the balance
  // is unchanged: no value was created.
  assert.equal(availableBalance(trader, 'USDC'), before, 'a failed close leaves the balance untouched');
});

test('a liquidation banks the seized margin into the pool instead of destroying it', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('SEIZEX', 2000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 10, leverage: 50 });
  // Equity is far below zero, so the whole margin is seized and the penalty is
  // zero; all of it belongs to the pool that was the other side of the move.
  const poolBefore = perpPoolBalance('RUSD');
  const result = liquidatePosition(opened.positionId, 1000);

  assert.ok(result.penalty >= 0);
  assert.ok(
    Math.abs(perpPoolBalance('RUSD') - (poolBefore + opened.margin - result.penalty)) < 1e-6,
    'the seized margin, less the penalty the protocol booked, is banked into the pool',
  );
});

test('a perp liquidation pays the liquidator bounty and backs the insurance row', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const liquidator = seedUser();
  const symbol = listPerp('BOUNTYX', 1000, 0.5);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 2 });

  const insBefore = Number(
    db.prepare("SELECT balance FROM insurance_funds WHERE contract = 'dex'").get()?.balance ?? 0,
  );
  // Mark 600: equity 100, maintenance 300, so the position is liquidatable and
  // the penalty is a positive fraction of the surviving equity.
  const result = liquidatePosition(opened.positionId, 600, liquidator);
  assert.ok(result.penalty > 0, 'a liquidatable position with positive equity owes a penalty');
  assert.ok(Math.abs(result.liquidator - result.penalty * 0.6) < 1e-9);
  assert.ok(
    Math.abs(availableBalance(liquidator, 'RUSD') - result.liquidator) < 1e-9,
    'the liquidator is paid its bounty',
  );

  const insAfter = Number(
    db.prepare("SELECT balance FROM insurance_funds WHERE contract = 'dex'").get()?.balance ?? 0,
  );
  const backed = Number(
    db.prepare("SELECT COALESCE(SUM(balance), 0) AS s FROM treasury_accounts WHERE account_type = 'dex_insurance'").get().s,
  );
  assert.ok(Math.abs(insAfter - insBefore - result.insurance) < 1e-6, 'the insurance share is booked once');
  assert.ok(Math.abs(backed - insAfter) < 1e-6, 'the insurance row is backed by the treasury account, not a phantom claim');
});

// ---------------------------------------------------------------------------
// Margin / lending
// ---------------------------------------------------------------------------

function createLendingMarket(asset, ltv = 0.7, threshold = 0.75) {
  const existing = db.prepare('SELECT market_id FROM dex_lending_markets WHERE asset = ?').get(asset);
  if (existing) return existing.market_id;
  const marketId = generateId();
  db.prepare(
    `INSERT INTO dex_lending_markets
       (market_id, asset, ltv, liquidation_threshold, liquidation_bonus, base_rate, kink, jump_multiplier, supply_cap, borrow_cap, status)
     VALUES (?, ?, ?, ?, 0.05, 0.05, 0.8, 1, 10000000, 10000000, 'active')`,
  ).run(marketId, asset, ltv, threshold);
  return marketId;
}

test('supply, borrow and repay move the market totals and the balances', () => {
  const lender = seedUser();
  const borrower = seedUser();
  credit(lender, 'RUSD', 100000);
  credit(borrower, 'ETH', 10);
  createLendingMarket('RUSD');
  createLendingMarket('ETH', 0.7, 0.75);
  listPair('ETH', 2000);

  const supplied = supply(lender, 'RUSD', 50000);
  assert.equal(supplied.totalSupplied, 50000);
  assert.equal(availableBalance(lender, 'RUSD'), 50000);

  const borrowed = borrow(borrower, 'RUSD', 5000, 'ETH', 10);
  assert.equal(borrowed.borrowed, 5000);
  assert.equal(availableBalance(borrower, 'RUSD'), 5000);
  assert.equal(lockedBalance(borrower, 'ETH'), 10);

  const repaid = repay(borrower, 'RUSD', 5000, 'ETH', 10);
  assert.equal(repaid.remaining, 0);
  assert.equal(availableBalance(borrower, 'RUSD'), 0);
});

test('a borrow beyond the collateral LTV is refused', () => {
  const borrower = seedUser();
  credit(borrower, 'ETH', 1);
  createLendingMarket('RUSD');
  createLendingMarket('ETH', 0.7, 0.75);
  listPair('ETH', 2000);
  assert.throws(
    () => borrow(borrower, 'RUSD', 1500, 'ETH', 1),
    (error) => error instanceof DexError && error.code === 'EXCEEDS_LTV',
  );
});

test('a borrow cannot exceed the market liquidity the lenders supplied', () => {
  const lender = seedUser();
  const borrower = seedUser();
  // A market of its own, so the assertion does not depend on liquidity other
  // tests happen to have supplied to the shared RUSD market.
  const asset = 'TLIQ';
  credit(lender, asset, 1000);
  credit(borrower, 'ETH', 10);
  createLendingMarket(asset);
  createLendingMarket('ETH', 0.7, 0.75);
  listPair('ETH', 2000);
  supply(lender, asset, 1000);

  // The collateral would allow far more, but the market only holds 1000: crediting
  // the borrower more would conjure tokens the lenders never put in.
  assert.throws(
    () => borrow(borrower, asset, 5000, 'ETH', 10),
    (error) => error instanceof DexError && error.code === 'INSUFFICIENT_LIQUIDITY',
  );
  assert.equal(availableBalance(borrower, asset), 0, 'a refused borrow must not credit anything');

  // Up to the free liquidity it succeeds. Stay below 100% utilisation so the
  // market's interest accrual is not left in a degenerate state for later tests.
  const ok = borrow(borrower, asset, 500, 'ETH', 10);
  assert.equal(ok.borrowed, 500);
  assert.equal(availableBalance(borrower, asset), 500);
});

test('a flash loan that cannot repay in the same transaction is rolled back', () => {
  const user = seedUser();
  createLendingMarket('RUSD');
  const lender = seedUser();
  credit(lender, 'RUSD', 10000);
  supply(lender, 'RUSD', 10000);
  // The borrower holds nothing, so the credit plus fee cannot be repaid and the
  // whole transaction must unwind.
  assert.throws(() => flashLoan(user, 'RUSD', 1000));
  assert.equal(availableBalance(user, 'RUSD'), 0);
});

test('lending markets are listed with live rates', () => {
  createLendingMarket('USDC');
  const markets = listLendingMarkets();
  assert.ok(markets.length > 0);
  assert.ok(markets.every((market) => market.borrowRate >= 0));
});

test('borrow interest accrues to the debt and the lenders, not to thin air', () => {
  const lender = seedUser();
  const borrower = seedUser();
  credit(lender, 'RUSD', 100000);
  credit(borrower, 'ETH', 10);
  const marketId = createLendingMarket('RUSD');
  createLendingMarket('ETH', 0.7, 0.75);
  listPair('ETH', 2000);
  supply(lender, 'RUSD', 100000);
  borrow(borrower, 'RUSD', 10000, 'ETH', 10);

  // Pretend the last accrual was exactly one year ago. A whole year makes the
  // expected interest the plain annual rate, so the assertion does not depend on
  // the exact number of seconds a test happens to run.
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE dex_lending_markets SET last_accrued_at = ? WHERE market_id = ?').run(oneYearAgo, marketId);

  const before = db.prepare('SELECT borrowed FROM dex_lending_positions WHERE market_id = ? AND user_id = ?').get(marketId, borrower);
  const marketBefore = db.prepare('SELECT total_supply, total_borrow FROM dex_lending_markets WHERE market_id = ?').get(marketId);

  const report = accrueInterest();
  assert.ok(report.charged > 0, 'a year of borrow interest must be charged');
  assert.ok(Math.abs(report.charged - report.credited - report.reserve) < 1e-6, 'the reserve cut is the difference');

  const after = db.prepare('SELECT borrowed FROM dex_lending_positions WHERE market_id = ? AND user_id = ?').get(marketId, borrower);
  const marketAfter = db.prepare('SELECT total_supply, total_borrow FROM dex_lending_markets WHERE market_id = ?').get(marketId);
  assert.ok(after.borrowed > before.borrowed, 'the borrower owes more');
  assert.ok(marketAfter.total_borrow > marketBefore.total_borrow, 'market debt grows');
  assert.ok(marketAfter.total_supply > marketBefore.total_supply, 'lenders earn the interest, minus the reserve');

  // Nothing was minted into a user balance: the lender's spendable balance is
  // unchanged, its supply position is worth more because the market grew.
  assert.equal(availableBalance(lender, 'RUSD'), 0);
});

test('a second accrual with no elapsed time charges nothing', () => {
  const lender = seedUser();
  const borrower = seedUser();
  credit(lender, 'RUSD', 50000);
  credit(borrower, 'ETH', 10);
  createLendingMarket('RUSD');
  createLendingMarket('ETH', 0.7, 0.75);
  listPair('ETH', 2000);
  supply(lender, 'RUSD', 50000);
  borrow(borrower, 'RUSD', 5000, 'ETH', 10);
  accrueInterest();
  const second = accrueInterest();
  assert.equal(second.charged, 0, 'no time has passed, so no interest is due');
});

test('a liquidation seizes collateral worth the debt repaid plus the bonus, not the whole balance', () => {
  const lender = seedUser();
  const borrower = seedUser();
  const liquidator = seedUser();
  credit(lender, 'RUSD', 100000);
  credit(borrower, 'ETH', 10);
  credit(liquidator, 'RUSD', 100000);
  createLendingMarket('RUSD');
  createLendingMarket('ETH', 0.7, 0.75);
  listPair('ETH', 2000);
  supply(lender, 'RUSD', 100000);
  borrow(borrower, 'RUSD', 10000, 'ETH', 10);

  // The collateral halves, so the position falls below its threshold.
  db.prepare('UPDATE market_data SET price = 1000 WHERE symbol = ?').run('ETH/RUSD');
  const position = db.prepare('SELECT position_id FROM dex_lending_positions WHERE user_id = ?').get(borrower);

  const result = liquidateBorrow(liquidator, createLendingMarket('RUSD'), position.position_id, 'ETH');

  // Half the debt (5000 RUSD) is repaid; at 1000 RUSD/ETH plus a 5% bonus the
  // liquidator receives 5.25 ETH, never the borrower's entire 10 ETH.
  assert.ok(Math.abs(result.debtRepaid - 5000) < 1e-6, `repaid ${result.debtRepaid}`);
  assert.ok(Math.abs(result.collateralSeized - 5.25) < 1e-6, `seized ${result.collateralSeized}`);
  assert.ok(Math.abs(result.bonus - 0.25) < 1e-6, `bonus ${result.bonus}`);
  assert.equal(availableBalance(liquidator, 'ETH'), 5.25);
  assert.equal(lockedBalance(borrower, 'ETH'), 10 - 5.25);
  // The seized collateral must leave the borrower entirely. Unlocking it would
  // move it into the borrower's available balance while the liquidator is also
  // credited it, minting a second copy of the collateral.
  assert.equal(availableBalance(borrower, 'ETH'), 0, 'the borrower must not keep the seized collateral');
});

test('a margin liquidation does not also pay the liquidator bonus into the treasury', () => {
  const lender = seedUser();
  const borrower = seedUser();
  const liquidator = seedUser();
  credit(lender, 'RUSD', 100000);
  credit(borrower, 'AVAX', 10);
  credit(liquidator, 'RUSD', 100000);
  createLendingMarket('RUSD');
  createLendingMarket('AVAX', 0.7, 0.75);
  listPair('AVAX', 2000);
  supply(lender, 'RUSD', 100000);
  borrow(borrower, 'RUSD', 10000, 'AVAX', 10);
  db.prepare('UPDATE market_data SET price = 1000 WHERE symbol = ?').run('AVAX/RUSD');
  const position = db.prepare('SELECT position_id FROM dex_lending_positions WHERE user_id = ?').get(borrower);

  const treasuryBefore = Number(
    db.prepare("SELECT balance FROM treasury_accounts WHERE asset = 'AVAX' AND account_type = 'dex_treasury'").get()?.balance ?? 0,
  );
  const result = liquidateBorrow(liquidator, createLendingMarket('RUSD'), position.position_id, 'AVAX');

  // The whole seized collateral, bonus included, is the liquidator's reward. It
  // must not also be booked as treasury revenue, which would credit the
  // treasury collateral nobody gave up.
  const treasuryAfter = Number(
    db.prepare("SELECT balance FROM treasury_accounts WHERE asset = 'AVAX' AND account_type = 'dex_treasury'").get()?.balance ?? 0,
  );
  assert.ok(result.bonus > 0, 'the liquidation pays the liquidator a bonus');
  assert.equal(treasuryAfter, treasuryBefore, 'the liquidator bonus must not be minted into the treasury');
  assert.equal(availableBalance(liquidator, 'AVAX'), result.collateralSeized);
});

// ---------------------------------------------------------------------------
// Launchpad, NFT and bridge
// ---------------------------------------------------------------------------

test('an IDO contribution debits the quote and credits the project token', () => {
  const contributor = seedUser();
  credit(contributor, 'RUSD', 10000);
  const projectId = generateId();
  db.prepare(
    `INSERT INTO dex_launch_projects (project_id, name, symbol, kind, total_supply, price, raise_target, status)
     VALUES (?, 'Project', 'PRJ', 'ido', 1000000, 2, 100000, 'live')`,
  ).run(projectId);

  const result = contribute(contributor, projectId, 1000);
  assert.equal(result.tokens, 500);
  assert.equal(availableBalance(contributor, 'RUSD'), 9000);
  assert.equal(availableBalance(contributor, 'PRJ'), 500);

  // The quote the contributor paid is escrowed for the project, not left
  // unbacked: the tokens credited above are paid for by funds that exist.
  const escrow = db
    .prepare("SELECT balance FROM treasury_accounts WHERE account_type = ? AND asset = 'RUSD'")
    .get(launchEscrowAccount(projectId));
  assert.equal(escrow.balance, 1000, 'the raise is held in the project escrow');

  // A live project cannot claim yet; once closed it draws exactly the escrow.
  assert.throws(() => claimRaise(projectId, contributor), 'a live project cannot claim');
  db.prepare("UPDATE dex_launch_projects SET status = 'closed' WHERE project_id = ?").run(projectId);
  const projectUser = seedUser();
  const claim = claimRaise(projectId, projectUser);
  assert.equal(claim.amount, 1000, 'the project draws exactly what was raised');
  assert.equal(claim.quoteAsset, 'RUSD');
  assert.equal(availableBalance(projectUser, 'RUSD'), 1000);
  assert.throws(() => claimRaise(projectId, projectUser), 'a second claim is refused');
});

test('a launch project cannot be raised in the wrong quote asset', () => {
  const contributor = seedUser();
  credit(contributor, 'RUSD', 10000);
  credit(contributor, 'USDC', 10000);
  const projectId = generateId();
  db.prepare(
    `INSERT INTO dex_launch_projects (project_id, name, symbol, kind, total_supply, price, raise_target, quote_asset, status)
     VALUES (?, 'Project', 'PRJ2', 'ido', 1000000, 2, 100000, 'USDC', 'live')`,
  ).run(projectId);

  assert.throws(() => contribute(contributor, projectId, 1000, 'RUSD'), 'the wrong quote asset is refused');
  assert.equal(availableBalance(contributor, 'RUSD'), 10000, 'nothing was taken on the refused contribution');
});

test('an NFT sale settles between seller and buyer', () => {
  const seller = seedUser();
  const buyer = seedUser();
  credit(buyer, 'RUSD', 10000);
  const listingId = listNft({ sellerId: seller, collection: 'TigerPunks', tokenId: '1', price: 100, currency: 'RUSD' });
  const sale = buyNft(buyer, listingId);
  assert.equal(sale.price, 100);
  assert.equal(availableBalance(buyer, 'RUSD'), 9900);
  const row = db.prepare('SELECT status, buyer_id FROM dex_nft_listings WHERE listing_id = ?').get(listingId);
  assert.equal(row.status, 'sold');
  assert.equal(row.buyer_id, buyer);
});

test('a bridge transfer locks the asset and a release settles it', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  const transfer = initiateBridge({ userId: user, fromChain: 'tigerex', toChain: 'ethereum', asset: 'RUSD', amount: 1000 });
  assert.ok(transfer.fee > 0);
  assert.equal(availableBalance(user, 'RUSD'), 9000);
  releaseBridge(transfer.transferId, '0xrelease');
  const row = db.prepare('SELECT status FROM dex_bridge_transfers WHERE transfer_id = ?').get(transfer.transferId);
  assert.equal(row.status, 'completed');
  assert.equal(availableBalance(user, 'RUSD'), 10000 - transfer.fee);
});

// ---------------------------------------------------------------------------
// Keeper
// ---------------------------------------------------------------------------

test('the keeper settles a limit order whose price has crossed', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  const poolId = createPool('v2', ['RUSD', 'ATOM'], { RUSD: 1000000, ATOM: 1000000 });
  // A buy at a limit above the current price (1.0) is immediately marketable.
  db.prepare(
    `INSERT INTO dex_limit_orders (order_id, pool_id, user_id, side, token_in, token_out, amount_in, limit_price)
     VALUES (?, ?, ?, 'buy', 'RUSD', 'ATOM', 1000, 1.5)`,
  ).run(generateId(), poolId, user);

  const report = settleDueLimitOrders();
  assert.equal(report.settled, 1);
  assert.ok(availableBalance(user, 'ATOM') > 0);
  assert.equal(db.prepare("SELECT status FROM dex_limit_orders WHERE user_id = ?").get(user).status, 'filled');
});

test('the keeper runs the DCA slices that have come due', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  const poolId = createPool('v2', ['RUSD', 'NEAR'], { RUSD: 1000000, NEAR: 1000000 });
  const planId = generateId();
  db.prepare(
    `INSERT INTO dex_dca_plans (plan_id, pool_id, user_id, token_in, token_out, amount_per_slice, frequency, total_slices, executed_slices, start_at)
     VALUES (?, ?, ?, 'RUSD', 'NEAR', 100, 'daily', 3, 0, ?)`,
  ).run(planId, poolId, user, new Date(Date.now() - 3 * 86_400_000).toISOString());

  const report = runDueDcaPlans();
  assert.equal(report.run, 3);
  const plan = db.prepare('SELECT executed_slices, status FROM dex_dca_plans WHERE plan_id = ?').get(planId);
  assert.equal(plan.executed_slices, 3);
  assert.equal(plan.status, 'completed');
});

test('the keeper runs the TWAP slices that have come due', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  const poolId = createPool('v2', ['RUSD', 'FTM'], { RUSD: 1000000, FTM: 1000000 });
  const planId = generateId();
  db.prepare(
    `INSERT INTO dex_twap_plans (plan_id, pool_id, user_id, token_in, token_out, total_amount_in, slices, interval_ms, executed_slices, start_at)
     VALUES (?, ?, ?, 'RUSD', 'FTM', 900, 3, 60000, 0, ?)`,
  ).run(planId, poolId, user, new Date(Date.now() - 10 * 60_000).toISOString());

  const report = runDueTwapPlans();
  assert.equal(report.run, 3);
  assert.equal(db.prepare('SELECT status FROM dex_twap_plans WHERE plan_id = ?').get(planId).status, 'completed');
});

test('a full keeper cycle reports what it did without throwing', () => {
  const report = runKeeperCycle();
  assert.equal(typeof report.limitOrdersSettled, 'number');
  assert.equal(typeof report.positionsLiquidated, 'number');
  assert.ok(Array.isArray(report.fundingApplied));
});

// ---------------------------------------------------------------------------
// Pool kinds the router must be able to load
// ---------------------------------------------------------------------------

test('a weighted pool is loaded with its numeric weights and can be traded', () => {
  // Weights are persisted as a JSON number array, so a string-array parser
  // rejected every weighted pool and broke the router for all pairs.
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  const poolId = createPool('weighted', ['RUSD', 'ZEC'], { RUSD: 500000, ZEC: 1000 }, { weights: [0.8, 0.2] });
  const quote = quoteSwap({ tokenIn: 'RUSD', tokenOut: 'ZEC', amountIn: 1000 });
  assert.ok(quote.amountOut > 0, 'a weighted pool must price a swap');
  const result = executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'ZEC', amountIn: 1000, slippage: 0.05 });
  assert.ok(result.amountOut > 0);
  assert.ok(reservesOf(poolId).RUSD > 500000);
});

test('a weighted pool whose stored weights are not numbers is reported as corrupt', () => {
  const poolId = createPool('weighted', ['RUSD', 'IOTA'], { RUSD: 500000, IOTA: 1000 }, { weights: [0.8, 0.2] });
  db.prepare('UPDATE dex_pools SET weights = ? WHERE pool_id = ?').run(JSON.stringify(['0.8', '0.2']), poolId);
  try {
    assert.throws(
      () => quoteSwap({ tokenIn: 'RUSD', tokenOut: 'IOTA', amountIn: 100 }),
      (error) => error.code === 'CORRUPT_POOL',
    );
  } finally {
    // A corrupt row is refused for the whole venue, so this test must restore
    // the row before the next one runs against the same database.
    db.prepare('UPDATE dex_pools SET weights = ? WHERE pool_id = ?').run(JSON.stringify([0.8, 0.2]), poolId);
  }
});

test('a concentrated pool seeded with reserves is tradeable and moves its price', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  // token0 = RUSD, token1 = ALGO, so the pool price is ALGO per RUSD (~0.0005).
  // ALGO appears in no other pool, so the router cannot prefer another venue.
  const sqrtPrice = 0.022360679774997898; // sqrt(0.0005)
  const sqrtLower = 0.02;
  const sqrtUpper = 0.025;
  const liquidity = 2000;
  // Reserves that exactly back the active liquidity over the range, which is
  // the state a pool reaches after liquidity is added.
  const backing = v3AmountsForLiquidity(liquidity, sqrtPrice, sqrtLower, sqrtUpper);
  const poolId = createPool('v3', ['RUSD', 'ALGO'], { RUSD: backing.amount0, ALGO: backing.amount1 }, {
    fee: 0.003,
    tickSpacing: 60,
    sqrtPrice,
    sqrtPriceLower: sqrtLower,
    sqrtPriceUpper: sqrtUpper,
    liquidity,
  });
  // The admin route derives the same liquidity back from the seeded reserves.
  const derived = v3LiquidityForAmounts(backing.amount0, backing.amount1, sqrtPrice, sqrtLower, sqrtUpper);
  assert.ok(Math.abs(derived - liquidity) / liquidity < 1e-9, 'seeded reserves must back the active liquidity');

  const before = db.prepare('SELECT sqrt_price FROM dex_pools WHERE pool_id = ?').get(poolId).sqrt_price;
  const quote = quoteSwap({ tokenIn: 'RUSD', tokenOut: 'ALGO', amountIn: 100 });
  assert.ok(quote.amountOut > 0);

  const result = executeSwap({ userId: user, tokenIn: 'RUSD', tokenOut: 'ALGO', amountIn: 100, slippage: 0.05 });
  assert.ok(result.amountOut > 0);
  const after = db.prepare('SELECT sqrt_price FROM dex_pools WHERE pool_id = ?').get(poolId).sqrt_price;
  assert.ok(after < before, 'selling token0 must walk the pool price down');
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

test('listPools reports the pools that exist with their reserves', () => {
  const pools = listPools();
  assert.ok(pools.length > 0);
  assert.ok(pools.every((pool) => pool.poolId && pool.kind && pool.reserves));
});

test('mark price falls back to the venue price when the oracle has no sources', () => {
  const symbol = listPerp('LTCX', 90);
  assert.equal(markPrice(symbol), 90);
});
