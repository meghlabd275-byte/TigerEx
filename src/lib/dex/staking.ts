/**
 * TigerSwap staking: veTGR locks, farm accounting and auto-compounding vaults.
 *
 * veTGR is a vote-escrow model: locking TGR for longer grants more voting power
 * that decays linearly to zero at unlock. Farms use the MasterChef
 * reward-per-share accounting so a late staker cannot claim rewards earned
 * before they joined. Vaults compound a farm's rewards back into the stake.
 * All three are pure functions over plain numbers and validate their inputs.
 */

import { AmmError } from '@/lib/dex/amm';
import { aprToPerSecond } from '@/lib/dex/fee-engine';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Lock a `MAX_LOCK_DAYS`-day stake for the full 1.0 voting-power multiplier. */
export const MAX_LOCK_DAYS = 1460; // 4 years
export const MIN_LOCK_DAYS = 7; // 1 week

export interface VeLockInput {
  amount: number;
  /** Lock duration in days, from MIN_LOCK_DAYS to MAX_LOCK_DAYS. */
  lockDays: number;
}

/**
 * Voting power for a lock: `amount * (lockDays / MAX_LOCK_DAYS)`.
 *
 * A four-year lock is worth the full amount; a one-week lock is worth a small
 * fraction. The result is what gauges read when weighting a vote, so it is
 * validated to be non-negative and finite.
 */
export function veVotingPower(input: VeLockInput): number {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'lock amount must be positive');
  }
  if (!Number.isFinite(input.lockDays) || input.lockDays < MIN_LOCK_DAYS || input.lockDays > MAX_LOCK_DAYS) {
    throw new AmmError('INVALID_LOCK', `lock duration must be between ${MIN_LOCK_DAYS} and ${MAX_LOCK_DAYS} days`);
  }
  return (input.amount * input.lockDays) / MAX_LOCK_DAYS;
}

/** Voting power still held at a point in time, decaying linearly to unlock. */
export function veVotingPowerAt(lockedAmount: number, unlockAt: number, now: number, lockedAt: number): number {
  if (!Number.isFinite(lockedAmount) || lockedAmount <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'locked amount must be positive');
  }
  if (!Number.isFinite(unlockAt) || !Number.isFinite(now) || !Number.isFinite(lockedAt)) {
    throw new AmmError('INVALID_TIME', 'timestamps must be finite');
  }
  if (unlockAt <= lockedAt) throw new AmmError('INVALID_LOCK', 'unlock must be after the lock');
  if (now >= unlockAt) return 0;
  if (now <= lockedAt) return lockedAmount;
  return (lockedAmount * (unlockAt - now)) / (unlockAt - lockedAt);
}

/** Unlock timestamp for a lock placed now for `lockDays` days. */
export function veUnlockAt(now: number, lockDays: number): number {
  if (!Number.isFinite(lockDays) || lockDays < MIN_LOCK_DAYS || lockDays > MAX_LOCK_DAYS) {
    throw new AmmError('INVALID_LOCK', `lock duration must be between ${MIN_LOCK_DAYS} and ${MAX_LOCK_DAYS} days`);
  }
  return now + lockDays * MS_PER_DAY;
}

/**
 * Boost multiplier applied to a farm position by a veTGR balance.
 *
 * The boost rises from 1x with no veTGR toward 2.5x as the position's veTGR
 * share grows, matching the published maximum. It never falls below 1x, so a
 * staker is never penalised for holding no veTGR.
 */
export function farmBoost(positionValue: number, vetgrBalance: number, totalVetgr: number, maxBoost = 2.5): number {
  if (!Number.isFinite(positionValue) || positionValue < 0) {
    throw new AmmError('INVALID_AMOUNT', 'positionValue must not be negative');
  }
  if (!Number.isFinite(vetgrBalance) || vetgrBalance < 0) {
    throw new AmmError('INVALID_AMOUNT', 'vetgrBalance must not be negative');
  }
  if (!Number.isFinite(totalVetgr) || totalVetgr < 0) {
    throw new AmmError('INVALID_AMOUNT', 'totalVetgr must not be negative');
  }
  if (!Number.isFinite(maxBoost) || maxBoost < 1) {
    throw new AmmError('INVALID_BOOST', 'maxBoost must be at least 1');
  }
  if (positionValue === 0 || totalVetgr === 0) return 1;
  const share = Math.min(vetgrBalance / totalVetgr, 1);
  return 1 + (maxBoost - 1) * share;
}

/**
 * A stake's weight in a boosted farm.
 *
 * Rewards are split by weight rather than by raw stake, so a position holding
 * veTGR earns a larger share of the same emission. The farm's total emission is
 * fixed, so a boost redistributes rewards toward veTGR holders instead of
 * creating new ones. A position with no veTGR keeps its raw stake as its weight.
 */
export function farmWeight(
  stakeAmount: number,
  vetgrBalance: number,
  totalVetgr: number,
  maxBoost = 2.5,
): number {
  return stakeAmount * farmBoost(stakeAmount, vetgrBalance, totalVetgr, maxBoost);
}

// ============================================================================
// Farm accounting (MasterChef reward-per-share)
// ============================================================================

export interface FarmState {
  /** Cumulative reward per staked unit, scaled by `ACC_PRECISION`. */
  accRewardPerShare: number;
  /** Total staked in the farm. */
  totalStaked: number;
  /** Rewards emitted per second. */
  rewardRate: number;
  /** Last time the accrual ran. */
  lastUpdate: number;
}

/** Precision of the reward-per-share accumulator. */
export const ACC_PRECISION = 1e12;

/**
 * Advance a farm's accumulator to `now`.
 *
 * When the farm holds no stake the rewards that would have been emitted are
 * simply not distributed; the accumulator is left unchanged so the next staker
 * cannot retroactively claim them.
 *
 * `totalWeight` is the sum of the stakes' weights. A boosted farm passes the
 * weighted total so the emission is split by weight; a farm with no boosts
 * passes the raw stake total and the two are the same. A zero weight means
 * nothing is staked, so the accrual is skipped rather than dividing by zero.
 */
export function accrueFarm(state: FarmState, now: number, totalWeight = state.totalStaked): FarmState {
  if (!Number.isFinite(now) || now < state.lastUpdate) {
    throw new AmmError('INVALID_TIME', 'now must not precede the last update');
  }
  if (state.totalStaked < 0 || !Number.isFinite(state.totalStaked)) {
    throw new AmmError('INVALID_STAKE', 'totalStaked must not be negative');
  }
  if (!Number.isFinite(totalWeight) || totalWeight < 0) {
    throw new AmmError('INVALID_WEIGHT', 'totalWeight must not be negative');
  }
  if (totalWeight === 0) {
    return { ...state, lastUpdate: now };
  }
  const elapsed = now - state.lastUpdate;
  const reward = state.rewardRate * elapsed;
  return {
    ...state,
    accRewardPerShare: state.accRewardPerShare + (reward * ACC_PRECISION) / totalWeight,
    lastUpdate: now,
  };
}

/**
 * Rewards a position has earned since its `rewardDebt` was set.
 *
 * `weight` is the stake's boosted weight, the same figure the accumulator was
 * advanced by; passing the raw stake in a boosted farm would understate what the
 * position earned.
 */
export function pendingFarmRewards(
  weight: number,
  accRewardPerShare: number,
  rewardDebt: number,
): number {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new AmmError('INVALID_AMOUNT', 'stake weight must not be negative');
  }
  const accrued = (weight * accRewardPerShare) / ACC_PRECISION;
  const pending = accrued - rewardDebt;
  return pending > 0 ? pending : 0;
}

/** The `rewardDebt` a stake of `weight` owes at the current accumulator. */
export function rewardDebtFor(weight: number, accRewardPerShare: number): number {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new AmmError('INVALID_AMOUNT', 'stake weight must not be negative');
  }
  return (weight * accRewardPerShare) / ACC_PRECISION;
}

export interface FarmDepositResult {
  state: FarmState;
  pending: number;
  rewardDebt: number;
  totalStaked: number;
}

/**
 * Deposit into a farm: settle the existing position, then stake the new amount.
 */
export function farmDeposit(
  state: FarmState,
  now: number,
  existingAmount: number,
  existingRewardDebt: number,
  depositAmount: number,
): FarmDepositResult {
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'deposit amount must be positive');
  }
  const accrued = accrueFarm(state, now);
  const pending = pendingFarmRewards(existingAmount, accrued.accRewardPerShare, existingRewardDebt);
  const totalStaked = accrued.totalStaked + depositAmount;
  return {
    state: { ...accrued, totalStaked },
    pending,
    rewardDebt: rewardDebtFor(existingAmount + depositAmount, accrued.accRewardPerShare),
    totalStaked,
  };
}

/** Withdraw from a farm: settle rewards, then remove the amount. */
export function farmWithdraw(
  state: FarmState,
  now: number,
  existingAmount: number,
  existingRewardDebt: number,
  withdrawAmount: number,
): FarmDepositResult {
  if (!Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'withdraw amount must be positive');
  }
  if (withdrawAmount > existingAmount) {
    throw new AmmError('INSUFFICIENT_STAKE', 'withdraw exceeds the staked amount');
  }
  const accrued = accrueFarm(state, now);
  const pending = pendingFarmRewards(existingAmount, accrued.accRewardPerShare, existingRewardDebt);
  const remaining = existingAmount - withdrawAmount;
  return {
    state: { ...accrued, totalStaked: accrued.totalStaked - withdrawAmount },
    pending,
    rewardDebt: rewardDebtFor(remaining, accrued.accRewardPerShare),
    totalStaked: remaining,
  };
}

/** Farm APR from its reward rate and the value of the staked pool. */
export function farmApr(rewardRatePerSecond: number, rewardTokenPrice: number, stakedValueUsd: number): number {
  if (!Number.isFinite(rewardRatePerSecond) || rewardRatePerSecond < 0) {
    throw new AmmError('INVALID_RATE', 'reward rate must not be negative');
  }
  if (!Number.isFinite(rewardTokenPrice) || rewardTokenPrice < 0) {
    throw new AmmError('INVALID_PRICE', 'reward token price must not be negative');
  }
  if (!Number.isFinite(stakedValueUsd) || stakedValueUsd <= 0) return 0;
  const yearly = rewardRatePerSecond * 365 * 24 * 60 * 60 * rewardTokenPrice;
  return yearly / stakedValueUsd;
}

/** Reward rate that produces a target APR against a staked value. */
export function rewardRateForApr(apr: number, rewardTokenPrice: number, stakedValueUsd: number): number {
  if (!Number.isFinite(apr) || apr < 0) throw new AmmError('INVALID_APR', 'apr must not be negative');
  if (!Number.isFinite(rewardTokenPrice) || rewardTokenPrice <= 0) {
    throw new AmmError('INVALID_PRICE', 'reward token price must be positive');
  }
  if (!Number.isFinite(stakedValueUsd) || stakedValueUsd < 0) {
    throw new AmmError('INVALID_VALUE', 'staked value must not be negative');
  }
  return (apr * stakedValueUsd) / (rewardTokenPrice * 365 * 24 * 60 * 60);
}

// ============================================================================
// Auto-compounding vaults
// ============================================================================

export interface VaultProjection {
  /** Value of the position after compounding. */
  finalValue: number;
  /** Total rewards earned and compounded. */
  rewardsEarned: number;
  /** The effective APY after compounding, from the stated APR. */
  effectiveApy: number;
}

/**
 * Project an auto-compounding vault over a horizon.
 *
 * Rewards are compounded every `compoundIntervalSeconds`, so the effective
 * yield is the discrete-compounded rate, not the nominal APR. The projection is
 * a real computation from the inputs, not a stored or advertised figure.
 */
export function vaultProjection(
  principal: number,
  apr: number,
  horizonDays: number,
  compoundIntervalSeconds = 24 * 60 * 60,
): VaultProjection {
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'principal must be positive');
  }
  if (!Number.isFinite(apr) || apr < 0) throw new AmmError('INVALID_APR', 'apr must not be negative');
  if (!Number.isFinite(horizonDays) || horizonDays <= 0) {
    throw new AmmError('INVALID_HORIZON', 'horizonDays must be positive');
  }
  if (!Number.isFinite(compoundIntervalSeconds) || compoundIntervalSeconds <= 0) {
    throw new AmmError('INVALID_INTERVAL', 'compound interval must be positive');
  }

  const horizonSeconds = horizonDays * 24 * 60 * 60;
  const periods = horizonSeconds / compoundIntervalSeconds;
  const perPeriodRate = (apr * compoundIntervalSeconds) / (365 * 24 * 60 * 60);
  const finalValue = principal * Math.pow(1 + perPeriodRate, periods);
  const effectiveApy = Math.pow(1 + aprToPerSecond(apr) * (365 * 24 * 60 * 60), 1) - 1;
  return { finalValue, rewardsEarned: finalValue - principal, effectiveApy };
}

/**
 * Auto-compound trigger: whether accumulated rewards are worth the gas to
 * harvest and restake. A harvest that costs more than it earns is refused.
 */
export function shouldCompound(rewardsValueUsd: number, gasCostUsd: number, minProfitBps = 100): boolean {
  if (!Number.isFinite(rewardsValueUsd) || rewardsValueUsd < 0) {
    throw new AmmError('INVALID_VALUE', 'rewards value must not be negative');
  }
  if (!Number.isFinite(gasCostUsd) || gasCostUsd < 0) {
    throw new AmmError('INVALID_VALUE', 'gas cost must not be negative');
  }
  if (!Number.isFinite(minProfitBps) || minProfitBps < 0) {
    throw new AmmError('INVALID_BPS', 'minProfitBps must not be negative');
  }
  const profit = rewardsValueUsd - gasCostUsd;
  if (profit <= 0) return false;
  return profit / gasCostUsd >= minProfitBps / 10_000;
}

/**
 * Gauge weight to emission conversion.
 *
 * Each epoch's emissions are shared across gauges in proportion to their
 * recorded vote weight, so a gauge's reward is its share of the total.
 */
export function gaugeEmission(weight: number, totalWeight: number, epochEmission: number): number {
  if (!Number.isFinite(weight) || weight < 0) throw new AmmError('INVALID_WEIGHT', 'weight must not be negative');
  if (!Number.isFinite(totalWeight) || totalWeight < 0) {
    throw new AmmError('INVALID_WEIGHT', 'total weight must not be negative');
  }
  if (!Number.isFinite(epochEmission) || epochEmission < 0) {
    throw new AmmError('INVALID_EMISSION', 'epoch emission must not be negative');
  }
  if (totalWeight === 0) return 0;
  return (epochEmission * weight) / totalWeight;
}
