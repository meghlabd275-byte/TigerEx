'use strict';
/**
 * Tests for the TigerSwap bot planners and the DEX margin position view.
 *
 * `bots.ts` holds the pure decision cores of the arbitrage, market-maker,
 * rebalancing and liquidation bots. `marginPositions` reports the health of a
 * borrow, and the health factor is only meaningful if the collateral quantity
 * is first valued in the borrowed asset — a raw quantity compared against a
 * debt is not a health factor.
 *
 * The DB-backed cases run against a real SQLite database built from the
 * production schema, so the price the valuation reads is a row the test wrote.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-dex-bots-')), 'dex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId } = require('../../.test-build/index.js');
const {
  gridLevels,
  gridAction,
  findArbitrage,
  marketMakerQuote,
  needsRebalance,
  planRebalance,
  liquidationCandidates,
  dcaShouldBuy,
  twapSlices,
  martingaleAmount,
  infinityGridLevels,
} = require('../../.test-build/bots.js');
const { marginPositions } = require('../../.test-build/margin-service.js');
const { v2GetAmountOut } = require('../../.test-build/amm.js');

const db = getDb();

// ---------------------------------------------------------------------------
// Grid bot
// ---------------------------------------------------------------------------

test('grid levels are arithmetic by default and geometric on request', () => {
  const arithmetic = gridLevels({ lowerPrice: 100, upperPrice: 200, levels: 3, orderSize: 100 });
  assert.deepEqual(arithmetic, [100, 150, 200]);
  const geometric = gridLevels({ lowerPrice: 100, upperPrice: 400, levels: 3, orderSize: 100, spacing: 'geometric' });
  assert.equal(geometric.length, 3);
  assert.equal(geometric[0], 100);
  assert.ok(Math.abs(geometric[1] - 200) < 1e-9);
  assert.ok(Math.abs(geometric[2] - 400) < 1e-9);
});

test('grid levels reject an inverted or degenerate range', () => {
  assert.throws(() => gridLevels({ lowerPrice: 200, upperPrice: 100, levels: 3, orderSize: 100 }), /upperPrice/);
  assert.throws(() => gridLevels({ lowerPrice: 0, upperPrice: 100, levels: 3, orderSize: 100 }), /lowerPrice/);
  assert.throws(() => gridLevels({ lowerPrice: 100, upperPrice: 200, levels: 1, orderSize: 100 }), /levels/);
  assert.throws(() => gridLevels({ lowerPrice: 100, upperPrice: 200, levels: 3, orderSize: 0 }), /orderSize/);
});

test('a step down through a level buys and a step up sells', () => {
  const config = { lowerPrice: 100, upperPrice: 200, levels: 3, orderSize: 100 };
  // Levels are 100, 150, 200. Falling from 160 to 140 crosses 150 on the way
  // down, so the bot buys at 150.
  const down = gridAction(config, 160, 140);
  assert.equal(down.action, 'buy');
  assert.equal(down.price, 150);
  // Rising from 140 to 160 crosses 150 on the way up, so it sells at 150.
  const up = gridAction(config, 140, 160);
  assert.equal(up.action, 'sell');
  assert.equal(up.price, 150);
  const flat = gridAction(config, 150, 150);
  assert.equal(flat.action, 'hold');
});

test('a grid order is rejected at a non-positive price', () => {
  const config = { lowerPrice: 100, upperPrice: 200, levels: 3, orderSize: 100 };
  assert.throws(() => gridAction(config, 0, 100), /positive/);
  assert.throws(() => gridAction(config, 100, -1), /positive/);
});

// ---------------------------------------------------------------------------
// Arbitrage bot
// ---------------------------------------------------------------------------

test('arbitrage finds the profitable size between two mispriced pools', () => {
  // Both pools hold 1,000 ETH. The cheaper one prices it at 2,000 RUSD
  // (2,000,000 RUSD reserve) and the dearer one at 2,100 RUSD (2,100,000 RUSD
  // reserve), so buying in the cheap pool and selling in the dear one profits.
  const fee = 0.003;
  const buy = (amountIn) => v2GetAmountOut(amountIn, { reserveIn: 2_000_000, reserveOut: 1_000 }, fee);
  const sell = (amountIn) => v2GetAmountOut(amountIn, { reserveIn: 1_000, reserveOut: 2_100_000 }, fee);
  const arb = findArbitrage(buy, sell, 'poolA', 'poolB', 'RUSD', 'ETH', 10_000);
  assert.ok(arb, 'an arbitrage should exist between the two pools');
  assert.ok(arb.profit > 0);
  assert.ok(arb.amountIn > 0 && arb.amountIn <= 10_000);
  assert.ok(arb.profitRate > 0);
});

test('arbitrage returns null when the two pools agree', () => {
  const fee = 0.003;
  // A round trip through one pool: buy RUSD->ETH, then sell the ETH back for
  // RUSD in the same pool. The two fees make it unprofitable.
  const buy = (amountIn) => v2GetAmountOut(amountIn, { reserveIn: 1_000_000, reserveOut: 2_000_000_000 }, fee);
  const sell = (amountIn) => v2GetAmountOut(amountIn, { reserveIn: 2_000_000_000, reserveOut: 1_000_000 }, fee);
  const arb = findArbitrage(buy, sell, 'poolA', 'poolB', 'RUSD', 'ETH', 10_000);
  assert.equal(arb, null);
});

test('arbitrage rejects a non-positive maximum', () => {
  const quote = (amountIn) => amountIn;
  assert.throws(() => findArbitrage(quote, quote, 'a', 'b', 'RUSD', 'ETH', 0), /maxAmountIn/);
});

// ---------------------------------------------------------------------------
// Market maker bot
// ---------------------------------------------------------------------------

test('a market maker quotes a spread around the mid and skews with inventory', () => {
  const balanced = marketMakerQuote(2000, 1, 2000, { spread: 0.001, depth: 10_000, rebalanceThreshold: 0.1 });
  assert.ok(balanced.bidPrice < 2000);
  assert.ok(balanced.askPrice > 2000);
  assert.equal(balanced.inventorySkew, 0);
  assert.ok(balanced.bidSize > 0 && balanced.askSize > 0);

  // Long the base asset: both quotes move down to encourage selling.
  const long = marketMakerQuote(2000, 10, 2000, { spread: 0.001, depth: 10_000, rebalanceThreshold: 0.1 });
  assert.ok(long.inventorySkew > 0);
  assert.ok(long.midPrice < balanced.midPrice);
});

test('market maker rejects a spread outside the unit interval', () => {
  assert.throws(() => marketMakerQuote(2000, 1, 1, { spread: 0, depth: 100, rebalanceThreshold: 0.1 }), /spread/);
  assert.throws(() => marketMakerQuote(2000, 1, 1, { spread: 1, depth: 100, rebalanceThreshold: 0.1 }), /spread/);
  assert.throws(() => marketMakerQuote(2000, 1, 1, { spread: 0.01, depth: 0, rebalanceThreshold: 0.1 }), /depth/);
});

test('rebalance triggers only past the threshold', () => {
  assert.equal(needsRebalance(1, 2000, 2000, 0.1), false);
  assert.equal(needsRebalance(10, 2000, 2000, 0.1), true);
  assert.throws(() => needsRebalance(1, 1, 0, 0.1), /fairPrice/);
});

// ---------------------------------------------------------------------------
// Rebalancing bot
// ---------------------------------------------------------------------------

test('rebalance trades restore the target weights', () => {
  const trades = planRebalance(
    [
      { token: 'BTC', value: 8000 },
      { token: 'ETH', value: 2000 },
    ],
    [
      { token: 'BTC', weight: 0.5 },
      { token: 'ETH', weight: 0.5 },
    ],
  );
  const btc = trades.find((t) => t.token === 'BTC');
  const eth = trades.find((t) => t.token === 'ETH');
  assert.ok(btc.deltaQuote < 0, 'BTC is overweight and must be sold');
  assert.ok(eth.deltaQuote > 0, 'ETH is underweight and must be bought');
  // The value is conserved: what one sells the other buys.
  assert.ok(Math.abs(btc.deltaQuote + eth.deltaQuote) < 1e-9);
});

test('rebalance drops trades below the minimum', () => {
  const trades = planRebalance(
    [
      { token: 'BTC', value: 5000.5 },
      { token: 'ETH', value: 4999.5 },
    ],
    [
      { token: 'BTC', weight: 0.5 },
      { token: 'ETH', weight: 0.5 },
    ],
    10,
  );
  assert.equal(trades.length, 0);
});

test('rebalance rejects an empty or worthless portfolio', () => {
  assert.throws(() => planRebalance([], [{ token: 'BTC', weight: 1 }]), /holdings/);
  assert.throws(() => planRebalance([{ token: 'BTC', value: 0 }], [{ token: 'BTC', weight: 1 }]), /no value/);
  assert.throws(() => planRebalance([{ token: 'BTC', value: 1 }], []), /targets/);
});

// ---------------------------------------------------------------------------
// Liquidation bot
// ---------------------------------------------------------------------------

test('liquidation candidates keep only unhealthy positions, richest bounty first', () => {
  const ranked = liquidationCandidates([
    { positionId: 'a', healthFactor: 0.9, bounty: 10 },
    { positionId: 'b', healthFactor: 1.05, bounty: 100 },
    { positionId: 'c', healthFactor: 0.5, bounty: 50 },
  ]);
  assert.deepEqual(ranked.map((c) => c.positionId), ['c', 'a']);
});

test('liquidation rejects a non-finite health factor', () => {
  assert.throws(() => liquidationCandidates([{ positionId: 'a', healthFactor: NaN, bounty: 1 }]), /health/);
  assert.throws(() => liquidationCandidates([{ positionId: 'a', healthFactor: 0.5, bounty: -1 }]), /bounty/);
});

// ---------------------------------------------------------------------------
// DCA bot
// ---------------------------------------------------------------------------

test('a DCA bot buys at or below its running average', () => {
  const history = [100, 110, 90, 100];
  assert.equal(dcaShouldBuy(history, 4, 95), true);
  assert.equal(dcaShouldBuy(history, 4, 105), false);
});

test('a DCA bot waits for a full lookback and rejects a bad price', () => {
  assert.equal(dcaShouldBuy([100, 100], 4, 50), false);
  assert.throws(() => dcaShouldBuy([100, 100, 100, 100], 4, 0), /price/);
  assert.throws(() => dcaShouldBuy([100], 0, 100), /lookback/);
});

// ---------------------------------------------------------------------------
// Bot service against live pools
// ---------------------------------------------------------------------------


const {
  createBotInstance,
  listBotInstances,
  setBotInstanceStatus,
  deleteBotInstance,
  evaluateBotInstance,
  scanArbitrage,
  runArbitrage,
  scanLiquidations,
  runBotInstance,
  runDueBotInstances,
} = require('../../.test-build/bot-service.js');

function seedUserAndFund(currencies) {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, 'x', 'active')`).run(
    userId,
    `${userId}@example.com`,
  );
  for (const [currency, amount] of Object.entries(currencies)) {
    const walletId = generateId();
    db.prepare(
      `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
    ).run(walletId, userId, currency);
    db.prepare(`INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`).run(
      generateId(),
      walletId,
      currency,
      amount,
    );
  }
  return userId;
}

function seedPool(tokens, reserves) {
  const poolId = generateId();
  db.prepare(
    `INSERT INTO dex_pools (pool_id, kind, address, tokens, fee, reserves, total_supply, status)
     VALUES (?, 'v2', ?, ?, 0.003, ?, 0, 'active')`,
  ).run(poolId, `0x${poolId.replace(/-/g, '').slice(0, 40)}`, JSON.stringify(tokens), JSON.stringify(reserves));
  return poolId;
}

test('a bot instance is stored and its parameters are validated by its planner', () => {
  const userId = seedUserAndFund({ RUSD: 1000 });
  const created = createBotInstance(userId, {
    botType: 'grid',
    params: { lowerPrice: 100, upperPrice: 200, levels: 5, orderSize: 10, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });
  assert.equal(created.botType, 'grid');
  const listed = listBotInstances(userId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, 'active');

  // A grid that cannot name the pair it trades is refused, since it could never run.
  assert.throws(
    () => createBotInstance(userId, { botType: 'grid', params: { lowerPrice: 100, upperPrice: 200, levels: 5, orderSize: 10 } }),
    /tokenIn and tokenOut/,
  );

  // An inverted grid range is refused at creation.
  assert.throws(
    () => createBotInstance(userId, { botType: 'grid', params: { lowerPrice: 200, upperPrice: 100, levels: 5, orderSize: 10, tokenIn: 'RUSD', tokenOut: 'ETH' } }),
    /upperPrice/,
  );
  assert.throws(() => createBotInstance(userId, { botType: 'nonsense', params: {} }), /botType/);
});

test('a bot instance can be paused and removed by its owner only', () => {
  const owner = seedUserAndFund({ RUSD: 1000 });
  const other = seedUserAndFund({ RUSD: 1000 });
  const created = createBotInstance(owner, {
    botType: 'dca',
    params: { lookback: 5, amountIn: 100, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });
  const paused = setBotInstanceStatus(owner, created.instanceId, 'paused');
  assert.equal(paused.status, 'paused');
  assert.throws(() => setBotInstanceStatus(other, created.instanceId, 'active'), /does not exist/);
  assert.throws(() => deleteBotInstance(other, created.instanceId), /does not exist/);
  assert.equal(deleteBotInstance(owner, created.instanceId).removed, true);
  assert.equal(listBotInstances(owner).length, 0);
});

test('the arbitrage scanner finds a real mispricing between two TigerSwap pools', () => {
  const userId = seedUserAndFund({ RUSD: 1_000_000, ETH: 100 });
  // Two RUSD/ETH pools with different reserves imply different prices, so one
  // buys in the cheaper and sells in the dearer.
  seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  seedPool(['RUSD', 'ETH'], { RUSD: 2_100_000, ETH: 1_000 });

  const opportunities = scanArbitrage(10_000);
  assert.ok(opportunities.length > 0, 'a mispricing between the two pools should be found');
  const best = opportunities[0];
  assert.ok(best.profit > 0);
  assert.ok(best.buyPoolId !== best.sellPoolId);

  // Running it settles both legs and leaves the trader with a profit.
  const before = require('../../.test-build/ledger.js').availableBalance(userId, 'RUSD');
  const result = runArbitrage(userId, {
    tokenIn: 'RUSD',
    tokenOut: 'ETH',
    buyPoolId: best.buyPoolId,
    sellPoolId: best.sellPoolId,
    maxAmountIn: 10_000,
  });
  const after = require('../../.test-build/ledger.js').availableBalance(userId, 'RUSD');
  assert.ok(result.buySwapId && result.sellSwapId);
  assert.ok(result.profit > 0, 'the settled round trip must be profitable');
  assert.ok(after > before, 'the trader balance must grow by the arbitrage profit');
});

test('running an arbitrage between two identical pools is refused', () => {
  const userId = seedUserAndFund({ RUSD: 1_000_000, ETH: 100 });
  seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  const same = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  assert.throws(
    () => runArbitrage(userId, { tokenIn: 'RUSD', tokenOut: 'ETH', buyPoolId: same, sellPoolId: same, maxAmountIn: 10_000 }),
    /must differ/,
  );
});

test('the liquidation scanner values collateral before ranking a position', () => {
  const borrower = seedUserAndFund({ BTC: 0 });
  // Lock one BTC as collateral against a 60,000 USDC debt while BTC is worth
  // 50,000 RUSD: collateral value 50,000, threshold 0.75 -> health 0.625, so it
  // is liquidatable and must appear in the scan.
  seedPrice('BTC/RUSD', 50_000);
  const marketId = generateId();
  db.prepare(
    `INSERT INTO dex_lending_markets
       (market_id, asset, ltv, liquidation_threshold, liquidation_bonus, base_rate, kink, jump_multiplier, supply_cap, borrow_cap)
     VALUES (?, 'USDC', 0.7, 0.75, 0.05, 0.05, 0.8, 1, 100000000, 100000000)`,
  ).run(marketId);
  db.prepare("UPDATE balances SET locked = 1 WHERE wallet_id IN (SELECT wallet_id FROM wallets WHERE user_id = ? AND currency = 'BTC')").run(borrower);
  const positionId = generateId();
  db.prepare(
    `INSERT INTO dex_lending_positions (position_id, market_id, user_id, supplied, borrowed, collateral_asset)
     VALUES (?, ?, ?, 0, 60000, 'BTC')`,
  ).run(positionId, marketId, borrower);

  const candidates = scanLiquidations();
  const found = candidates.find((c) => c.positionId === positionId);
  assert.ok(found, 'an underwater position must be listed');
  assert.ok(found.healthFactor < 1);
  assert.ok(found.bounty > 0);
});

test('evaluating a grid bot reports the action for the live price move', () => {
  const userId = seedUserAndFund({ RUSD: 100_000 });
  const poolId = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  const created = createBotInstance(userId, {
    botType: 'grid',
    poolId,
    params: { lowerPrice: 1500, upperPrice: 2500, levels: 5, orderSize: 100, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });
  const instance = listBotInstances(userId).find((i) => i.instanceId === created.instanceId);
  // With no recorded previous price the first evaluation primes the bot.
  const primed = evaluateBotInstance(instance);
  assert.equal(primed.action, 'prime');
  assert.ok(Number(primed.detail.price) > 0);
});

test('a grid bot step primes, then settles a real buy when the price falls through a level', () => {
  const userId = seedUserAndFund({ RUSD: 1_000_000, ETH: 100 });
  const poolId = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  const created = createBotInstance(userId, {
    botType: 'grid',
    poolId,
    params: { lowerPrice: 1000, upperPrice: 3000, levels: 5, orderSize: 100, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });

  // First step primes the grid with the live price and trades nothing.
  const prime = runBotInstance(userId, created.instanceId);
  assert.equal(prime.action, 'prime');
  assert.equal(prime.executed, false);

  // Push the pool price down so it crosses a grid level, then the next step
  // must settle a buy of RUSD into ETH.
  db.prepare('UPDATE dex_pools SET reserves = ? WHERE pool_id = ?').run(
    JSON.stringify({ RUSD: 1_500_000, ETH: 1_000 }),
    poolId,
  );
  const ethBefore = require('../../.test-build/ledger.js').availableBalance(userId, 'ETH');
  const step = runBotInstance(userId, created.instanceId);
  assert.equal(step.action, 'buy');
  assert.equal(step.executed, true);
  assert.ok(step.swapId, 'a buy step must settle a swap');
  const ethAfter = require('../../.test-build/ledger.js').availableBalance(userId, 'ETH');
  assert.ok(ethAfter > ethBefore, 'the grid buy must credit the trader with the output token');
});

test('a DCA bot step settles a real buy when the price sits below its running average', () => {
  const userId = seedUserAndFund({ RUSD: 1_000_000, ETH: 100 });
  const poolId = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  // Three settled swaps at 2000 RUSD per ETH build the running average.
  for (let i = 0; i < 3; i += 1) {
    db.prepare(
      `INSERT INTO dex_swaps (swap_id, pool_id, user_id, token_in, token_out, amount_in, amount_out)
       VALUES (?, ?, ?, 'RUSD', 'ETH', 2000, 1)`,
    ).run(generateId(), poolId, userId);
  }
  const created = createBotInstance(userId, {
    botType: 'dca',
    poolId,
    params: { lookback: 3, amountIn: 100, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });

  // The live price falls below the average, so the next step must buy.
  db.prepare('UPDATE dex_pools SET reserves = ? WHERE pool_id = ?').run(
    JSON.stringify({ RUSD: 1_500_000, ETH: 1_000 }),
    poolId,
  );
  const ethBefore = require('../../.test-build/ledger.js').availableBalance(userId, 'ETH');
  const step = runBotInstance(userId, created.instanceId);
  assert.equal(step.action, 'buy');
  assert.equal(step.executed, true);
  assert.ok(step.swapId, 'a DCA buy must settle a swap');
  assert.ok(
    require('../../.test-build/ledger.js').availableBalance(userId, 'ETH') > ethBefore,
    'the DCA buy must credit the trader with the output token',
  );
});

test('a paused bot refuses to run', () => {
  const userId = seedUserAndFund({ RUSD: 1_000 });
  const poolId = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  const created = createBotInstance(userId, {
    botType: 'grid',
    poolId,
    params: { lowerPrice: 1000, upperPrice: 3000, levels: 5, orderSize: 100, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });
  setBotInstanceStatus(userId, created.instanceId, 'paused');
  assert.throws(() => runBotInstance(userId, created.instanceId), /paused/);
});

test('the bot sweep steps an active instance and leaves a paused one alone', () => {
  const userId = seedUserAndFund({ RUSD: 1_000_000, ETH: 100 });
  const poolId = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  const active = createBotInstance(userId, {
    botType: 'grid',
    poolId,
    params: { lowerPrice: 1000, upperPrice: 3000, levels: 5, orderSize: 100, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });
  const paused = createBotInstance(userId, {
    botType: 'grid',
    poolId,
    params: { lowerPrice: 1000, upperPrice: 3000, levels: 5, orderSize: 100, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });
  setBotInstanceStatus(userId, paused.instanceId, 'paused');

  const swept = runDueBotInstances(Date.now());
  const mine = swept.filter((r) => r.userId === userId);
  assert.equal(mine.length, 1, 'only the active instance is stepped');
  assert.equal(mine[0].instanceId, active.instanceId);
  assert.equal(mine[0].action, 'prime', 'the first scheduled step primes the grid');

  // The interval gate stops a second step from trading again immediately, but
  // once the interval has elapsed the sweep steps the instance again.
  const tooSoon = runDueBotInstances(Date.now()).find((r) => r.instanceId === active.instanceId);
  assert.equal(tooSoon.reason, 'interval not elapsed');
  const later = runDueBotInstances(Date.now() + 61_000).find((r) => r.instanceId === active.instanceId);
  assert.ok(later && later.reason === undefined, 'the instance steps again once its interval elapses');
});

// ---------------------------------------------------------------------------
// TWAP, martingale and infinity grid
// ---------------------------------------------------------------------------

test('TWAP slices sum to the parent and the last slice absorbs the remainder', () => {
  const slices = twapSlices({ totalQuantity: 10, slices: 3, intervalSeconds: 60 });
  assert.equal(slices.length, 3);
  assert.ok(Math.abs(slices.reduce((a, b) => a + b, 0) - 10) < 1e-9, 'the slices must sum to the parent');
  assert.ok(slices[0] === slices[1], 'all but the last slice are equal');
  assert.ok(slices[2] > 0);
  assert.throws(() => twapSlices({ totalQuantity: 0, slices: 3, intervalSeconds: 60 }), /totalQuantity/);
  assert.throws(() => twapSlices({ totalQuantity: 10, slices: 1, intervalSeconds: 60 }), /slices/);
  assert.throws(() => twapSlices({ totalQuantity: 10, slices: 3, intervalSeconds: 0 }), /intervalSeconds/);
});

test('a martingale amount grows by the multiplier and is capped', () => {
  const config = { baseAmount: 100, multiplier: 2, maxAmount: 350 };
  assert.equal(martingaleAmount(config, 0), 100);
  assert.equal(martingaleAmount(config, 1), 200);
  // 100 * 2^2 = 400 exceeds the 350 cap.
  assert.equal(martingaleAmount(config, 2), 350);
  assert.throws(() => martingaleAmount({ baseAmount: 0, multiplier: 2, maxAmount: 100 }, 0), /baseAmount/);
  assert.throws(() => martingaleAmount({ baseAmount: 100, multiplier: 0.5, maxAmount: 100 }, 0), /multiplier/);
  assert.throws(() => martingaleAmount({ baseAmount: 100, multiplier: 2, maxAmount: 50 }, 0), /maxAmount/);
  assert.throws(() => martingaleAmount(config, -1), /step/);
});

test('an infinity grid ladders geometrically with buys below and sells above', () => {
  const levels = infinityGridLevels({ ratio: 2, budget: 400, depth: 2 }, 100);
  assert.equal(levels.length, 4);
  const buys = levels.filter((l) => l.side === 'buy');
  const sells = levels.filter((l) => l.side === 'sell');
  assert.equal(buys.length, 2);
  assert.equal(sells.length, 2);
  assert.ok(buys.every((l) => l.price < 100), 'buy levels sit below the anchor');
  assert.ok(sells.every((l) => l.price > 100), 'sell levels sit above the anchor');
  assert.ok(Math.abs(buys[buys.length - 1].price - 50) < 1e-9);
  assert.ok(Math.abs(sells[0].price - 200) < 1e-9);
  assert.throws(() => infinityGridLevels({ ratio: 1, budget: 400, depth: 2 }, 100), /ratio/);
  assert.throws(() => infinityGridLevels({ ratio: 2, budget: 0, depth: 2 }, 100), /budget/);
  assert.throws(() => infinityGridLevels({ ratio: 2, budget: 400, depth: 0 }, 100), /depth/);
  assert.throws(() => infinityGridLevels({ ratio: 2, budget: 400, depth: 2 }, 0), /anchorPrice/);
});

test('a TWAP bot step settles one slice per run and stops when the schedule is done', () => {
  const userId = seedUserAndFund({ RUSD: 1_000_000, ETH: 100 });
  const poolId = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  const created = createBotInstance(userId, {
    botType: 'twap',
    poolId,
    params: { totalQuantity: 300, slices: 3, intervalSeconds: 60, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });

  const ethBefore = require('../../.test-build/ledger.js').availableBalance(userId, 'ETH');
  for (let i = 0; i < 3; i += 1) {
    const step = runBotInstance(userId, created.instanceId);
    assert.equal(step.action, 'twap', `slice ${i} must settle`);
    assert.equal(step.executed, true);
    assert.ok(step.swapId, 'each slice is a real swap');
  }
  // The schedule is spent, so the next step reports completion and trades nothing.
  const done = runBotInstance(userId, created.instanceId);
  assert.equal(done.action, 'complete');
  assert.equal(done.executed, false);
  assert.ok(
    require('../../.test-build/ledger.js').availableBalance(userId, 'ETH') > ethBefore,
    'the slices must credit the trader with the output token',
  );
});

test('a martingale bot step buys the next sized amount and records the step', () => {
  const userId = seedUserAndFund({ RUSD: 1_000_000, ETH: 100 });
  const poolId = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  const created = createBotInstance(userId, {
    botType: 'martingale',
    poolId,
    params: { baseAmount: 100, multiplier: 2, maxAmount: 1000, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });

  const first = runBotInstance(userId, created.instanceId);
  assert.equal(first.action, 'buy');
  assert.equal(first.executed, true);
  assert.equal(first.amountIn, 100);
  const second = runBotInstance(userId, created.instanceId);
  assert.equal(second.amountIn, 200, 'the second buy doubles the first');
});

test('an infinity grid bot primes, then settles a real buy when the price falls', () => {
  const userId = seedUserAndFund({ RUSD: 1_000_000, ETH: 100 });
  const poolId = seedPool(['RUSD', 'ETH'], { RUSD: 2_000_000, ETH: 1_000 });
  const created = createBotInstance(userId, {
    botType: 'infinity_grid',
    poolId,
    params: { ratio: 1.5, budget: 1000, depth: 3, tokenIn: 'RUSD', tokenOut: 'ETH' },
  });

  const prime = runBotInstance(userId, created.instanceId);
  assert.equal(prime.action, 'prime');
  assert.equal(prime.executed, false);

  db.prepare('UPDATE dex_pools SET reserves = ? WHERE pool_id = ?').run(
    JSON.stringify({ RUSD: 1_500_000, ETH: 1_000 }),
    poolId,
  );
  const ethBefore = require('../../.test-build/ledger.js').availableBalance(userId, 'ETH');
  const step = runBotInstance(userId, created.instanceId);
  assert.equal(step.action, 'buy');
  assert.equal(step.executed, true);
  assert.ok(step.swapId, 'a buy step must settle a swap');
  assert.ok(
    require('../../.test-build/ledger.js').availableBalance(userId, 'ETH') > ethBefore,
    'the infinity-grid buy must credit the trader with the output token',
  );
});

test('the new bot types are refused when their parameters cannot form a plan', () => {
  const userId = seedUserAndFund({ RUSD: 1000 });
  assert.throws(
    () => createBotInstance(userId, { botType: 'twap', params: { totalQuantity: 100, slices: 1, intervalSeconds: 60, tokenIn: 'RUSD', tokenOut: 'ETH' } }),
    /slices/,
  );
  assert.throws(
    () => createBotInstance(userId, { botType: 'martingale', params: { baseAmount: 100, multiplier: 0.5, maxAmount: 100, tokenIn: 'RUSD', tokenOut: 'ETH' } }),
    /multiplier/,
  );
  assert.throws(
    () => createBotInstance(userId, { botType: 'infinity_grid', params: { ratio: 1, budget: 1000, depth: 3, tokenIn: 'RUSD', tokenOut: 'ETH' } }),
    /ratio/,
  );
});


function seedPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (symbol, price, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, updated_at = datetime('now')`,
  ).run(symbol, price);
}

test('a margin position health factor values the collateral before comparing it to the debt', () => {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, 'x', 'active')`).run(
    userId,
    `${userId}@example.com`,
  );

  // One BTC of collateral, priced at 50,000 RUSD, and a 30,000 RUSD debt. The
  // liquidation threshold is 0.75, so the health factor is
  // 50,000 * 0.75 / 30,000 = 1.25 — healthy. A position of 1 BTC against a
  // 30,000 debt is only liquidatable if the quantity is mistaken for a value.
  seedPrice('BTC/RUSD', 50_000);

  const marketId = generateId();
  db.prepare(
    `INSERT INTO dex_lending_markets
       (market_id, asset, ltv, liquidation_threshold, liquidation_bonus, base_rate, kink, jump_multiplier, supply_cap, borrow_cap)
     VALUES (?, 'RUSD', 0.7, 0.75, 0.05, 0.05, 0.8, 1, 100000000, 100000000)`,
  ).run(marketId);

  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', 'BTC', 'TIGEREX')`,
  ).run(walletId, userId);
  db.prepare(`INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, 'BTC', 0, 1)`).run(
    generateId(),
    walletId,
  );

  db.prepare(
    `INSERT INTO dex_lending_positions (position_id, market_id, user_id, supplied, borrowed, collateral_asset)
     VALUES (?, ?, ?, 0, 30000, 'BTC')`,
  ).run(generateId(), marketId, userId);

  const positions = marginPositions(userId);
  assert.equal(positions.length, 1);
  const health = positions[0].healthFactor;
  assert.ok(typeof health === 'number' && Number.isFinite(health), 'a health factor must be reported');
  assert.ok(Math.abs(health - 1.25) < 1e-6, `expected 1.25, got ${health}`);
  assert.ok(health >= 1, 'a collateralised position must not read as liquidatable');
});

test('a margin position with unpriced collateral reports no health factor', () => {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, 'x', 'active')`).run(
    userId,
    `${userId}@example.com`,
  );
  const marketId = generateId();
  db.prepare(
    `INSERT INTO dex_lending_markets
       (market_id, asset, ltv, liquidation_threshold, liquidation_bonus, base_rate, kink, jump_multiplier, supply_cap, borrow_cap)
     VALUES (?, 'DAI', 0.7, 0.75, 0.05, 0.05, 0.8, 1, 100000000, 100000000)`,
  ).run(marketId);
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', 'ZZZ', 'TIGEREX')`,
  ).run(walletId, userId);
  db.prepare(`INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, 'ZZZ', 0, 5)`).run(
    generateId(),
    walletId,
  );
  db.prepare(
    `INSERT INTO dex_lending_positions (position_id, market_id, user_id, supplied, borrowed, collateral_asset)
     VALUES (?, ?, ?, 0, 1000, 'ZZZ')`,
  ).run(generateId(), marketId, userId);

  const positions = marginPositions(userId);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].healthFactor, null, 'unpriced collateral must not produce a health factor');
});
