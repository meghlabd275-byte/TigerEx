'use strict';
/**
 * Correctness tests for the TigerSwap fee engine and staking module. The cases
 * assert that a fee split always sums back to the fee, that veTGR voting power
 * decays correctly, and that farm accounting never pays a late staker for
 * rewards earned before they joined.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { AmmError } = require('../../.test-build/amm.js');
const fees = require('../../.test-build/fee-engine.js');
const staking = require('../../.test-build/staking.js');

const {
  applySchedule,
  validateSchedule,
  DEFAULT_SWAP_SPLIT,
  DEFAULT_PERP_SPLIT,
  splitTotal,
  aprToApy,
} = fees;

const {
  veVotingPower,
  veVotingPowerAt,
  veUnlockAt,
  farmBoost,
  farmWeight,
  accrueFarm,
  pendingFarmRewards,
  rewardDebtFor,
  farmDeposit,
  farmWithdraw,
  farmApr,
  rewardRateForApr,
  vaultProjection,
  shouldCompound,
  gaugeEmission,
  MAX_LOCK_DAYS,
  MIN_LOCK_DAYS,
} = staking;

test('the default swap split sums to the whole fee', () => {
  const split = applySchedule(100, DEFAULT_SWAP_SPLIT);
  assert.ok(Math.abs(splitTotal(split) - 100) < 1e-9);
  assert.ok(Math.abs(split.lp - 70) < 1e-9);
});

test('the default perp split sums to the whole fee', () => {
  const split = applySchedule(3.14159, DEFAULT_PERP_SPLIT);
  assert.ok(Math.abs(splitTotal(split) - 3.14159) < 1e-12);
});

test('a schedule that does not sum to 10000 bps is refused', () => {
  assert.throws(
    () => validateSchedule({ lpBps: 5000, vetgrBps: 2000, treasuryBps: 1000, insuranceBps: 0, burnBps: 0 }),
    AmmError,
  );
});

test('a negative fee is refused', () => {
  assert.throws(() => applySchedule(-1, DEFAULT_SWAP_SPLIT), AmmError);
});

test('apr to apy compounds above the nominal rate', () => {
  const apy = aprToApy(0.1, 365);
  assert.ok(apy > 0.1);
});

test('veTGR voting power scales with lock length', () => {
  const short = veVotingPower({ amount: 1000, lockDays: MIN_LOCK_DAYS });
  const long = veVotingPower({ amount: 1000, lockDays: MAX_LOCK_DAYS });
  assert.ok(long > short);
  assert.ok(Math.abs(long - 1000) < 1e-9);
});

test('veTGR rejects a lock outside the permitted range', () => {
  assert.throws(() => veVotingPower({ amount: 1000, lockDays: 0 }), AmmError);
  assert.throws(() => veVotingPower({ amount: 1000, lockDays: MAX_LOCK_DAYS + 1 }), AmmError);
});

test('veTGR voting power decays linearly to zero at unlock', () => {
  const now = 1_000_000_000;
  const unlock = veUnlockAt(now, 100);
  const mid = veVotingPowerAt(1000, unlock, now + (unlock - now) / 2, now);
  assert.ok(mid > 0 && mid < 1000);
  assert.equal(veVotingPowerAt(1000, unlock, unlock + 1, now), 0);
});

test('farm boost rises with veTGR share and is never below 1x', () => {
  assert.equal(farmBoost(100, 0, 1000), 1);
  const boosted = farmBoost(100, 1000, 1000);
  assert.ok(boosted > 1 && boosted <= 2.5);
});

test('farm accrual distributes rewards per staked unit', () => {
  const state = { accRewardPerShare: 0, totalStaked: 100, rewardRate: 1, lastUpdate: 0 };
  const next = accrueFarm(state, 10);
  assert.ok(Math.abs(next.accRewardPerShare - (10 * 1e12) / 100) < 1e-3);
});

test('a boosted farm splits the emission by weight, not by raw stake', () => {
  // Two stakers with the same stake, but one holds all the veTGR and so carries
  // the full boost. The emission is fixed, so the boosted staker takes a larger
  // share of it and the plain staker a smaller one.
  const plain = farmWeight(100, 0, 1000);
  const boosted = farmWeight(100, 1000, 1000);
  assert.equal(plain, 100);
  assert.ok(boosted > plain, 'veTGR must raise the weight');

  const state = { accRewardPerShare: 0, totalStaked: 200, rewardRate: 100, lastUpdate: 0 };
  const advanced = accrueFarm(state, 1, plain + boosted);
  const plainPending = pendingFarmRewards(plain, advanced.accRewardPerShare, 0);
  const boostedPending = pendingFarmRewards(boosted, advanced.accRewardPerShare, 0);
  assert.ok(boostedPending > plainPending, 'the boosted staker earns more of the same emission');
  // The two shares together are exactly the emission, so a boost redistributes
  // rather than mints.
  assert.ok(Math.abs(plainPending + boostedPending - 100) < 1e-6);
});

test('a farm with no weight accrues nothing rather than dividing by zero', () => {
  const state = { accRewardPerShare: 5, totalStaked: 0, rewardRate: 1, lastUpdate: 0 };
  const next = accrueFarm(state, 10, 0);
  assert.equal(next.accRewardPerShare, 5);
  assert.equal(next.lastUpdate, 10);
});

test('a late staker earns nothing for time before joining', () => {
  const state = { accRewardPerShare: 0, totalStaked: 100, rewardRate: 1, lastUpdate: 0 };
  const accrued = accrueFarm(state, 100);
  // The new staker joins after the accrual; their debt equals the accrued share.
  const debt = rewardDebtFor(50, accrued.accRewardPerShare);
  const pending = pendingFarmRewards(50, accrued.accRewardPerShare, debt);
  assert.equal(pending, 0);
});

test('a farm deposit settles pending rewards and increases the stake', () => {
  const state = { accRewardPerShare: 0, totalStaked: 100, rewardRate: 2, lastUpdate: 0 };
  const result = farmDeposit(state, 100, 50, 0, 50);
  assert.ok(result.pending > 0);
  assert.equal(result.state.totalStaked, 150);
});

test('a farm withdrawal cannot exceed the stake', () => {
  const state = { accRewardPerShare: 0, totalStaked: 100, rewardRate: 1, lastUpdate: 0 };
  assert.throws(() => farmWithdraw(state, 10, 50, 0, 60), AmmError);
});

test('farm apr and reward rate are inverses', () => {
  const apr = farmApr(1, 2, 1_000_000);
  const rate = rewardRateForApr(apr, 2, 1_000_000);
  assert.ok(Math.abs(rate - 1) < 1e-9);
});

test('a vault projection compounds above simple interest', () => {
  const projection = vaultProjection(1000, 0.5, 365, 24 * 60 * 60);
  assert.ok(projection.finalValue > 1500, `got ${projection.finalValue}`);
  assert.ok(projection.rewardsEarned > 500);
});

test('compounding is refused when it does not pay for its own gas', () => {
  assert.equal(shouldCompound(1, 10), false);
  assert.equal(shouldCompound(100, 1), true);
});

test('gauge emission is proportional to weight', () => {
  assert.ok(Math.abs(gaugeEmission(25, 100, 1000) - 250) < 1e-9);
  assert.equal(gaugeEmission(0, 0, 1000), 0);
});
