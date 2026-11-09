'use strict';
/**
 * Tests for the TigerSwap modules added for zap, vaults, liquid staking, MEV
 * protection, V4 hooks and sniping.
 *
 * The pure modules are exercised directly; the DB-backed services are driven
 * against a real SQLite database so a deposit, a harvest, a stake and a
 * withdrawal move real balances and the share accounting is checked against the
 * rows the services wrote. Nothing is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-dex2-')), 'dex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, creditAvailable } = require('../../.test-build/ledger.js');
const { AmmError, v2GetAmountOut, v2Invariant, v2PriceImpact } = require('../../.test-build/amm.js');
const { zapSplitV2, zapSplit, zapOutAmounts } = require('../../.test-build/zap.js');
const {
  assetsPerShare,
  sharesForDeposit,
  assetsForWithdrawal,
  applyCompound,
  harvestable,
  projectSharePrice,
  performanceFee,
} = require('../../.test-build/vault.js');
const {
  exchangeRate,
  sharesForStake,
  tgrForUnstake,
  applyRewards,
  impliedApy,
} = require('../../.test-build/liquid-staking.js');
const { assessRisk, detectSandwich, orderPrivateFlow, commitmentFor } = require('../../.test-build/mev.js');
const { dynamicFee, shouldFireLimit, twammSlice, antiMevCheck, composeHooks } = require('../../.test-build/hooks.js');
const { snipeEligibility, planSnipe, rankCandidates } = require('../../.test-build/sniping.js');

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

function seedBalance(userId, currency, amount) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, currency, amount);
}

// ---------------------------------------------------------------------------
// Zap math
// ---------------------------------------------------------------------------

test('zapSplitV2 balances the deposit to the pool ratio', () => {
  const amount = 1000;
  const reserves = { reserveIn: 50000, reserveOut: 25 };
  const fee = 0.003;
  const plan = zapSplitV2(amount, reserves, fee);

  const swappedOut = v2GetAmountOut(plan.swapIn, reserves, fee);
  assert.ok(Math.abs(plan.depositOut - swappedOut) < 1e-9, 'depositOut must be the real swap output');
  assert.ok(Math.abs(plan.swapIn + plan.depositIn - amount) < 1e-9, 'the split must consume the whole input');

  // The two deposits must be in the pool's own ratio, which is the balance
  // condition the quadratic solves for.
  const ratio = plan.depositIn / plan.depositOut;
  const poolRatio = reserves.reserveIn / reserves.reserveOut;
  assert.ok(Math.abs(ratio - poolRatio) < 1e-6, `deposit ratio ${ratio} must match pool ratio ${poolRatio}`);
});

test('zapSplitV2 preserves the pool invariant through the swap leg', () => {
  const reserves = { reserveIn: 50000, reserveOut: 25 };
  const fee = 0.003;
  const plan = zapSplitV2(1000, reserves, fee);
  const out = v2GetAmountOut(plan.swapIn, reserves, fee);
  const kAfter = v2Invariant({ reserveIn: reserves.reserveIn + plan.swapIn * (1 - fee), reserveOut: reserves.reserveOut - out });
  assert.ok(Math.abs(kAfter - v2Invariant(reserves)) < 1e-3, 'k must be preserved across the swap leg');
});

test('zapSplit agrees with the closed form when given the same quote', () => {
  const amount = 1000;
  const reserves = { reserveIn: 50000, reserveOut: 25 };
  const fee = 0.003;
  const closed = zapSplitV2(amount, reserves, fee);
  const bisected = zapSplit(amount, reserves.reserveIn, reserves.reserveOut, (x) => v2GetAmountOut(x, reserves, fee));
  assert.ok(Math.abs(closed.swapIn - bisected.swapIn) < 1e-6, 'the two solvers must agree');
});

test('zapSplitV2 rejects a non-positive input', () => {
  assert.throws(() => zapSplitV2(0, { reserveIn: 100, reserveOut: 100 }, 0.003), AmmError);
  assert.throws(() => zapSplitV2(-5, { reserveIn: 100, reserveOut: 100 }, 0.003), AmmError);
});

test('zapOutAmounts returns a single token and respects the fee', () => {
  const reserves = { reserveIn: 1000, reserveOut: 1000 };
  const fee = 0.003;
  const out = zapOutAmounts(100, 1000, reserves, 'in', fee);
  assert.ok(Math.abs(out.amountIn - 100) < 1e-9);
  assert.ok(Math.abs(out.amountOut - 100) < 1e-9);
  // Proceeds are the wanted side plus the swapped other side, less the fee on
  // the swapped leg, so it must exceed the wanted side alone.
  assert.ok(out.proceeds > out.amountIn, 'proceeds must include the swapped side');
});

// ---------------------------------------------------------------------------
// Vault share accounting
// ---------------------------------------------------------------------------

test('an empty vault prices one share at one asset', () => {
  assert.equal(assetsPerShare({ totalAssets: 0, totalSupply: 0 }), 1);
});

test('a deposit does not change the share price', () => {
  const before = { totalAssets: 1000, totalSupply: 1000 };
  const shares = sharesForDeposit(before, 500);
  const after = { totalAssets: before.totalAssets + 500, totalSupply: before.totalSupply + shares };
  assert.ok(Math.abs(assetsPerShare(after) - assetsPerShare(before)) < 1e-12, 'a deposit must not move the share price');
});

test('a harvest raises the share price for existing holders', () => {
  const state = { totalAssets: 1000, totalSupply: 1000 };
  const result = applyCompound(state, 10, 100);
  const after = { totalAssets: result.totalAssets, totalSupply: state.totalSupply };
  assert.ok(assetsPerShare(after) > assetsPerShare(state), 'the harvest must raise the price');
  assert.ok(Math.abs(result.perShareGain - 0.1) < 1e-12, 'the gain must be spread across the shares');
});

test('a late depositor cannot claim earlier rewards', () => {
  // Alice deposits 1000, the vault earns 1000, then Bob deposits 1000.
  let state = { totalAssets: 0, totalSupply: 0 };
  const aliceShares = sharesForDeposit(state, 1000);
  state = { totalAssets: 1000, totalSupply: aliceShares };
  state = { totalAssets: 2000, totalSupply: aliceShares }; // the harvest
  const bobShares = sharesForDeposit(state, 1000);
  state = { totalAssets: 3000, totalSupply: aliceShares + bobShares };

  const aliceValue = assetsForWithdrawal(state, aliceShares);
  const bobValue = assetsForWithdrawal(state, bobShares);
  // Alice put in 1000 and the vault doubled before Bob arrived, so she must be
  // able to withdraw about 2000; Bob put in 1000 at the higher price and must
  // get about 1000 back, not a share of Alice's gain.
  assert.ok(aliceValue > 1900, `Alice must keep her gain, got ${aliceValue}`);
  assert.ok(bobValue < 1100, `Bob must not capture Alice's gain, got ${bobValue}`);
});

test('a withdrawal larger than the position is refused', () => {
  assert.throws(() => assetsForWithdrawal({ totalAssets: 100, totalSupply: 100 }, 200), AmmError);
});

test('harvestable refuses a harvest below the minimum', () => {
  assert.equal(harvestable(5, 10), 0);
  assert.equal(harvestable(15, 10), 15);
});

test('a performance fee is charged on the gain only', () => {
  const { fee, net } = performanceFee(1000, 1000);
  assert.equal(fee, 100);
  assert.equal(net, 900);
  assert.deepEqual(performanceFee(0, 1000), { fee: 0, net: 0 });
  assert.throws(() => performanceFee(100, 10000), AmmError);
});

test('projectSharePrice compounds', () => {
  const oneYear = projectSharePrice(0.2, 12, 1);
  assert.ok(oneYear > 1.2 && oneYear < 1.23, `monthly compounding of 20% must beat simple, got ${oneYear}`);
});

// ---------------------------------------------------------------------------
// Liquid staking
// ---------------------------------------------------------------------------

test('the exchange rate starts at one and rises with rewards', () => {
  const empty = { totalStaked: 0, totalShares: 0, pendingWithdrawal: 0 };
  assert.equal(exchangeRate(empty), 1);

  const state = { totalStaked: 1000, totalShares: 1000, pendingWithdrawal: 0 };
  const result = applyRewards(state, 100);
  assert.ok(result.rate > 1, 'rewards must raise the rate');
  assert.ok(Math.abs(result.rate - 1.1) < 1e-12, 'a 10% reward must move the rate to 1.1');
});

test('a stake mints shares at the current rate', () => {
  const state = { totalStaked: 1100, totalShares: 1000, pendingWithdrawal: 0 };
  const shares = sharesForStake(state, 110);
  // At a rate of 1.1, 110 TGR must mint 100 stTGR.
  assert.ok(Math.abs(shares - 100) < 1e-9, `expected 100 shares, got ${shares}`);
});

test('an unstake returns the staked amount plus rewards, less the fee', () => {
  const state = { totalStaked: 1100, totalShares: 1000, pendingWithdrawal: 0 };
  const gross = tgrForUnstake(state, 100, 0);
  assert.ok(Math.abs(gross - 110) < 1e-9, `expected 110 TGR, got ${gross}`);
  const net = tgrForUnstake(state, 100, 0.01);
  assert.ok(Math.abs(net - 108.9) < 1e-9, `expected 108.9 TGR after a 1% fee, got ${net}`);
});

test('a redemption larger than the pool is refused', () => {
  assert.throws(() => tgrForUnstake({ totalStaked: 100, totalShares: 100 }, 200, 0), AmmError);
});

test('rewards cannot be distributed with no shares outstanding', () => {
  assert.throws(() => applyRewards({ totalStaked: 0, totalShares: 0, pendingWithdrawal: 0 }, 100), AmmError);
});

test('impliedApy annualises a reward', () => {
  const day = 24 * 60 * 60;
  const apy = impliedApy(1000, 1, day);
  assert.ok(Math.abs(apy - 0.365) < 1e-6, `expected 36.5% APY, got ${apy}`);
});

// ---------------------------------------------------------------------------
// MEV protection
// ---------------------------------------------------------------------------

test('a small order is not worth protecting', () => {
  const risk = assessRisk({ orderId: 'o1', tokenIn: 'A', tokenOut: 'B', amountIn: 1, reserveIn: 1000000, reserveOut: 1000000, slippageTolerance: 0.01 });
  assert.equal(risk.shouldProtect, false);
  assert.ok(risk.score < 1);
});

test('a large order is routed to the private path', () => {
  const risk = assessRisk({ orderId: 'o2', tokenIn: 'A', tokenOut: 'B', amountIn: 200000, reserveIn: 1000000, reserveOut: 1000000, slippageTolerance: 0.05 });
  assert.equal(risk.shouldProtect, true);
});

test('the MEV score is capped at one', () => {
  const risk = assessRisk({ orderId: 'o3', tokenIn: 'A', tokenOut: 'B', amountIn: 900000, reserveIn: 1000000, reserveOut: 1000000, slippageTolerance: 0.9 });
  assert.ok(risk.score <= 1);
});

test('a sandwich is detected', () => {
  const swaps = [
    { trader: 'attacker', tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 100 },
    { trader: 'victim', tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 },
    { trader: 'attacker', tokenIn: 'TGR', tokenOut: 'RUSD', amountIn: 110 },
  ];
  const result = detectSandwich(swaps);
  assert.equal(result.detected, true);
  assert.deepEqual(result.attackers, ['attacker']);
  assert.equal(result.victim, 'victim');
});

test('a plain sequence of unrelated trades is not a sandwich', () => {
  const swaps = [
    { trader: 'a', tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 100 },
    { trader: 'b', tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 },
    { trader: 'c', tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 110 },
  ];
  assert.equal(detectSandwich(swaps).detected, false);
});

test('private flow orders by commit time and is deterministic on ties', () => {
  const plan = orderPrivateFlow(
    [
      { orderId: 'b', committedAt: 100 },
      { orderId: 'a', committedAt: 100 },
      { orderId: 'c', committedAt: 50 },
    ],
    'batch1',
  );
  assert.deepEqual(plan.entries.map((e) => e.orderId), ['c', 'a', 'b']);
  assert.equal(commitmentFor('a', 'batch1'), plan.commitments.a);
  assert.equal(plan.entries.length, 3);
});

// ---------------------------------------------------------------------------
// V4 hooks
// ---------------------------------------------------------------------------

test('the dynamic fee rises with volatility and is bounded', () => {
  const config = { baseFee: 0.003, maxFee: 0.01, volatilityCeiling: 0.05 };
  assert.equal(dynamicFee(config, 0), 0.003);
  assert.equal(dynamicFee(config, 0.1), 0.01);
  const mid = dynamicFee(config, 0.025);
  assert.ok(mid > 0.003 && mid < 0.01, `expected an intermediate fee, got ${mid}`);
});

test('a dynamic fee configuration with max below base is refused', () => {
  assert.throws(() => dynamicFee({ baseFee: 0.01, maxFee: 0.003, volatilityCeiling: 0.05 }, 0), AmmError);
});

test('a limit order fires on the correct side of its trigger', () => {
  const buy = { orderId: 'x', side: 'buy', triggerPrice: 100, amountIn: 1, filled: false };
  assert.equal(shouldFireLimit(buy, 99).fire, true);
  assert.equal(shouldFireLimit(buy, 100).fire, true);
  assert.equal(shouldFireLimit(buy, 101).fire, false);

  const sell = { orderId: 'y', side: 'sell', triggerPrice: 100, amountIn: 1, filled: false };
  assert.equal(shouldFireLimit(sell, 101).fire, true);
  assert.equal(shouldFireLimit(sell, 99).fire, false);

  assert.equal(shouldFireLimit({ ...buy, filled: true }, 50).fire, false);
});

test('a TWAMM slice is proportional to elapsed time and completes at the end', () => {
  const state = { remainingIn: 1000, durationSeconds: 3600, startedAt: 0, lastExecutedAt: 0 };
  const slice = twammSlice(state, 360);
  // One tenth of the duration elapsed, so one tenth of the order should run.
  assert.ok(Math.abs(slice - 100) < 1e-6, `expected 100, got ${slice}`);
  assert.equal(twammSlice(state, 3600), 1000, 'the whole order must run at the end');
  assert.equal(twammSlice(state, 0), 0, 'no time elapsed means no slice');
});

test('the anti-MEV hook blocks a swap after the price was pushed against it', () => {
  const buy = antiMevCheck({ blockOpenPrice: 100, currentPrice: 105, tolerance: 0.02 }, 'buy');
  assert.equal(buy.allowed, false, 'a buyer must be blocked when the price ran up');
  const sell = antiMevCheck({ blockOpenPrice: 100, currentPrice: 105, tolerance: 0.02 }, 'sell');
  assert.equal(sell.allowed, true, 'a seller benefits from a higher price and must not be blocked');
});

test('composeHooks rejects a swap the anti-MEV hook blocks', () => {
  assert.throws(
    () =>
      composeHooks(
        { volatility: 0.01, side: 'buy', blockOpenPrice: 100, currentPrice: 110 },
        { baseFee: 0.003, antiMevTolerance: 0.02 },
      ),
    (error) => error instanceof AmmError && error.code === 'MEV_BLOCKED',
  );
});

test('composeHooks reports the hooks that touched the swap', () => {
  const result = composeHooks(
    { volatility: 0.025, side: 'sell', blockOpenPrice: 100, currentPrice: 101 },
    { baseFee: 0.003, dynamicFee: { baseFee: 0.003, maxFee: 0.01, volatilityCeiling: 0.05 }, antiMevTolerance: 0.02 },
  );
  assert.ok(result.applied.includes('dynamicFee'));
  assert.ok(result.applied.includes('antiMev'));
  assert.ok(result.fee > 0.003);
});

// ---------------------------------------------------------------------------
// Sniping
// ---------------------------------------------------------------------------

const SNIPE_POLICY = { windowSeconds: 300, minLiquidity: 1000, maxImpact: 0.1 };

test('a fresh, funded, open pool is snipeable', () => {
  const candidate = { poolId: 'p1', createdAt: 1000, liquidityIn: 10000, tradingEnabled: true, flagged: false };
  assert.equal(snipeEligibility(candidate, SNIPE_POLICY, 1100).eligible, true);
});

test('an old pool is no longer a snipe', () => {
  const candidate = { poolId: 'p1', createdAt: 1000, liquidityIn: 10000, tradingEnabled: true, flagged: false };
  assert.equal(snipeEligibility(candidate, SNIPE_POLICY, 5000).eligible, false);
});

test('a flagged or closed pool is refused', () => {
  const flagged = { poolId: 'p1', createdAt: 1000, liquidityIn: 10000, tradingEnabled: true, flagged: true };
  assert.equal(snipeEligibility(flagged, SNIPE_POLICY, 1100).eligible, false);
  const closed = { poolId: 'p1', createdAt: 1000, liquidityIn: 10000, tradingEnabled: false, flagged: false };
  assert.equal(snipeEligibility(closed, SNIPE_POLICY, 1100).eligible, false);
});

test('a snipe is capped so its own impact stays within policy', () => {
  const reserves = { reserveIn: 10000, reserveOut: 10000 };
  const plan = planSnipe(9000, reserves, 0.003, 0.1, { maxImpact: 0.05, gasMultiplier: 2 });
  assert.ok(plan.impact <= 0.05 + 1e-6, `impact ${plan.impact} must be within the cap`);
  assert.ok(plan.amountIn < 9000, 'the size must be reduced to respect the cap');
  assert.ok(plan.minOut < plan.expectedOut, 'minOut must be below the expected output');
  assert.equal(plan.gasMultiplier, 2);
});

test('a snipe within the impact cap is not resized', () => {
  const reserves = { reserveIn: 1000000, reserveOut: 1000000 };
  const plan = planSnipe(1000, reserves, 0.003, 0.1, { maxImpact: 0.1, gasMultiplier: 2 });
  assert.equal(plan.amountIn, 1000);
});

test('candidates are ranked with the fresh and deep pool first', () => {
  const ranked = rankCandidates(
    [
      { poolId: 'old', createdAt: 100, liquidityIn: 10000, tradingEnabled: true, flagged: false },
      { poolId: 'fresh', createdAt: 1050, liquidityIn: 20000, tradingEnabled: true, flagged: false },
    ],
    SNIPE_POLICY,
    1100,
  );
  assert.equal(ranked[0].poolId, 'fresh');
});

test('an ineligible candidate is not ranked', () => {
  const ranked = rankCandidates(
    [{ poolId: 'flagged', createdAt: 1050, liquidityIn: 20000, tradingEnabled: true, flagged: true }],
    SNIPE_POLICY,
    1100,
  );
  assert.equal(ranked.length, 0);
});

test('v2PriceImpact rises with trade size', () => {
  const reserves = { reserveIn: 1000, reserveOut: 1000 };
  assert.ok(v2PriceImpact(100, reserves) < v2PriceImpact(500, reserves));
});

// ---------------------------------------------------------------------------
// DB-backed services
// ---------------------------------------------------------------------------

test('vault deposit and withdrawal move real balances and preserve the price', () => {
  const { depositVault, withdrawVault, vaultDetail } = require('../../.test-build/vault-service.js');
  const userId = seedUser();
  seedBalance(userId, 'TGR', 1000);

  const vaultId = generateId();
  db.prepare(
    `INSERT INTO dex_vaults (vault_id, name, kind, pool_id, staked_token, reward_token, performance_fee_bps, min_harvest, total_assets, total_supply)
     VALUES (?, ?, 'lp', 'pool1', 'TGR', 'RYUSD', 1000, 0, 0, 0)`,
  ).run(vaultId, `vault-${vaultId}`);

  const deposit = depositVault(userId, vaultId, 500);
  assert.equal(deposit.shares, 500, 'the first deposit is one share per asset');
  assert.equal(availableBalance(userId, 'TGR'), 500, 'the deposit must leave the balance');

  const withdrawal = withdrawVault(userId, vaultId, 500);
  assert.ok(Math.abs(withdrawal.assets - 500) < 1e-9, 'a full withdrawal at the same price returns the deposit');
  assert.ok(Math.abs(availableBalance(userId, 'TGR') - 1000) < 1e-6, 'the balance must be restored');
  assert.equal(vaultDetail(vaultId).totalSupply, 0, 'all shares must be burned');
});

test('a harvest raises the vault share price from funded rewards, not minted value', () => {
  const { depositVault, harvestVault, vaultDetail, fundVaultRewards } = require('../../.test-build/vault-service.js');
  const userId = seedUser();
  seedBalance(userId, 'TGR', 1000);

  const vaultId = generateId();
  db.prepare(
    `INSERT INTO dex_vaults (vault_id, name, kind, pool_id, staked_token, reward_token, performance_fee_bps, min_harvest, total_assets, total_supply)
     VALUES (?, ?, 'lp', 'pool2', 'TGR', 'RYUSD', 1000, 0, 0, 0)`,
  ).run(vaultId, `vault-${vaultId}`);

  depositVault(userId, vaultId, 1000);
  const before = vaultDetail(vaultId).sharePrice;

  // The gain must be funded before it can be compounded; an unfunded harvest
  // must fail closed instead of minting the assets into the vault.
  assert.throws(
    () => harvestVault(vaultId, 100, 100),
    (error) => error.code === 'REWARD_FUND_EMPTY',
  );

  fundVaultRewards(vaultId, 'TGR', 100);
  const harvest = harvestVault(vaultId, 100, 100);
  const after = vaultDetail(vaultId);

  assert.equal(harvest.skipped, false);
  assert.equal(harvest.performanceFee, 10, 'a 10% fee on a 100 gain is 10');
  assert.equal(after.totalSupply, 1000, 'a harvest must not mint shares');
  assert.ok(after.sharePrice > before, 'the harvest must lift the share price');
  // The revenue ledger must record the fee.
  const revenue = db
    .prepare(`SELECT amount FROM dex_revenue_ledger WHERE source = 'dex_vault_fee' AND asset = 'TGR'`)
    .get();
  assert.ok(revenue && Math.abs(revenue.amount - 10) < 1e-9, 'the performance fee must be recorded');
});

test('liquid staking moves real balances and raises the rate on funded rewards', () => {
  const { stakeLiquid, unstakeLiquid, distributeRewards, liquidStakeDetail, fundLiquidStakingRewards } = require('../../.test-build/liquid-staking-service.js');
  const userId = seedUser();
  seedBalance(userId, 'TGR', 1000);

  const stakeId = generateId();
  db.prepare(
    `INSERT INTO dex_liquid_staking (stake_id, name, stake_token, receipt_token, redemption_fee_bps, total_staked, total_shares)
     VALUES (?, ?, 'TGR', 'stTGR', 0, 0, 0)`,
  ).run(stakeId, `stake-${stakeId}`);

  const staked = stakeLiquid(stakeId, userId, 500);
  assert.equal(staked.shares, 500, 'the first stake is one share per token');
  assert.equal(availableBalance(userId, 'TGR'), 500);

  // Rewards are real tokens: the account must be funded before the rate can
  // rise. Distributing from an empty account must fail closed.
  assert.throws(() => distributeRewards(stakeId, 50), (error) => error.code === 'REWARD_FUND_EMPTY');

  fundLiquidStakingRewards('TGR', 50);
  distributeRewards(stakeId, 50);
  const detail = liquidStakeDetail(stakeId);
  assert.ok(Math.abs(detail.exchangeRate - 1.1) < 1e-9, `rate should be 1.1, got ${detail.exchangeRate}`);

  const unstaked = unstakeLiquid(stakeId, userId, 500);
  assert.ok(Math.abs(unstaked.received - 550) < 1e-9, `expected 550 TGR back, got ${unstaked.received}`);
  assert.ok(Math.abs(availableBalance(userId, 'TGR') - 1050) < 1e-6, 'the balance must include the reward');
});

test('a liquid unstake cannot exceed the position', () => {
  const { stakeLiquid, unstakeLiquid } = require('../../.test-build/liquid-staking-service.js');
  const userId = seedUser();
  seedBalance(userId, 'TGR', 100);

  const stakeId = generateId();
  db.prepare(
    `INSERT INTO dex_liquid_staking (stake_id, name, stake_token, receipt_token, redemption_fee_bps, total_staked, total_shares)
     VALUES (?, ?, 'TGR', 'stTGR', 0, 0, 0)`,
  ).run(stakeId, `stake-${stakeId}`);

  stakeLiquid(stakeId, userId, 100);
  assert.throws(() => unstakeLiquid(stakeId, userId, 200), /shares/);
});

test('a zap into a constant-product pool produces a balanced position', () => {
  const { zapIn } = require('../../.test-build/zap-service.js');
  const { addLiquidity } = require('../../.test-build/liquidity-service.js');
  const userId = seedUser();
  seedBalance(userId, 'RUSD', 100000);
  seedBalance(userId, 'ALGO', 1000);

  const poolId = generateId();
  db.prepare(
    `INSERT INTO dex_pools (pool_id, kind, address, tokens, fee, reserves, total_supply, status)
     VALUES (?, 'v2', ?, ?, 0.003, ?, 0, 'active')`,
  ).run(poolId, `0x${poolId.replace(/-/g, '').slice(0, 40)}`, JSON.stringify(['RUSD', 'ALGO']), JSON.stringify({ RUSD: 0, ALGO: 0 }));

  // Seed the pool with real liquidity so the zap has reserves to balance against.
  addLiquidity({ userId, poolId, amounts: { RUSD: 50000, ALGO: 25 } });

  const result = zapIn({ userId, poolId, tokenIn: 'RUSD', amountIn: 1000 });
  assert.ok(result.liquidity > 0, 'the zap must mint liquidity');
  assert.ok(result.deposited.RUSD > 0 && result.deposited.ALGO > 0, 'both sides must be deposited');

  const row = db.prepare('SELECT reserves FROM dex_pools WHERE pool_id = ?').get(poolId);
  const reserves = JSON.parse(row.reserves);
  // The pool must remain in roughly the same ratio it started in.
  const ratio = reserves.RUSD / reserves.ALGO;
  assert.ok(Math.abs(ratio - 2000) / 2000 < 0.05, `pool ratio drifted to ${ratio}`);
});

test('a zap refuses a token that is not in the pool', () => {
  const { zapIn } = require('../../.test-build/zap-service.js');
  const { addLiquidity } = require('../../.test-build/liquidity-service.js');
  const userId = seedUser();
  seedBalance(userId, 'RUSD', 100000);
  seedBalance(userId, 'ALGO', 1000);
  seedBalance(userId, 'ZEC', 1000);

  const poolId = generateId();
  db.prepare(
    `INSERT INTO dex_pools (pool_id, kind, address, tokens, fee, reserves, total_supply, status)
     VALUES (?, 'v2', ?, ?, 0.003, ?, 0, 'active')`,
  ).run(poolId, `0x${poolId.replace(/-/g, '').slice(0, 40)}`, JSON.stringify(['RUSD', 'ALGO']), JSON.stringify({ RUSD: 0, ALGO: 0 }));
  addLiquidity({ userId, poolId, amounts: { RUSD: 50000, ALGO: 25 } });

  assert.throws(() => zapIn({ userId, poolId, tokenIn: 'ZEC', amountIn: 100 }), /ZEC/);
});
