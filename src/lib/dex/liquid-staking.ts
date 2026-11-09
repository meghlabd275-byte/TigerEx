/**
 * TigerSwap liquid staking (stTGR).
 *
 * A liquid-staking token lets a holder stake TGR and keep a tradable claim on
 * it. The receipt, stTGR, is priced by an exchange rate that rises as staking
 * rewards accrue, so stTGR is worth more than 1 TGR over time and the holder can
 * use it elsewhere while it is staked.
 *
 * The subtlety is that the two operations are not symmetric. Minting on stake
 * and burning on unstake must use the same rate, and a withdrawal must not be
 * allowed to take out more than the total staked principal can back, or the
 * last unstaker is left with a claim the contract cannot honour. The rate is
 * only ever moved by `applyRewards`, which is driven by real reward
 * distributions, never by time alone.
 */

import { AmmError, requirePositive, requireFee } from '@/lib/dex/amm';

export interface LiquidStakeState {
  /** TGR held in the staking contract. */
  totalStaked: number;
  /** stTGR outstanding. */
  totalShares: number;
  /** Unbonding (queued for withdrawal) TGR. */
  pendingWithdrawal: number;
}

/** TGR represented by one stTGR. Starts at 1 and only rises. */
export function exchangeRate(state: LiquidStakeState): number {
  const staked = Number(state.totalStaked);
  const shares = Number(state.totalShares);
  if (!Number.isFinite(staked) || staked < 0) {
    throw new AmmError('INVALID_STATE', 'totalStaked must be a non-negative finite number');
  }
  if (!Number.isFinite(shares) || shares < 0) {
    throw new AmmError('INVALID_STATE', 'totalShares must be a non-negative finite number');
  }
  if (shares === 0) return 1;
  return staked / shares;
}

/**
 * stTGR minted for a deposit of `tgr`.
 *
 * A deposit after the rate has risen mints fewer stTGR, which is what keeps an
 * early and a late staker on equal footing: each holds a claim worth the TGR
 * they put in plus their share of rewards since.
 */
export function sharesForStake(state: LiquidStakeState, tgr: number): number {
  const amount = requirePositive(tgr, 'tgr');
  return amount / exchangeRate(state);
}

/**
 * TGR returned for burning `shares`.
 *
 * A redemption fee is taken, which is the protocol's share of the staking
 * yield; it is charged on the TGR returned, not on the shares, so a partial
 * redemption pays proportionally.
 */
export function tgrForUnstake(state: LiquidStakeState, shares: number, fee: number): number {
  const amount = requirePositive(shares, 'shares');
  const f = requireFee(fee);
  if (amount > state.totalShares) {
    throw new AmmError('INSUFFICIENT_SHARES', 'shares exceed totalShares');
  }
  const gross = amount * exchangeRate(state);
  if (gross > state.totalStaked) {
    throw new AmmError('INSUFFICIENT_LIQUIDITY', 'the staking contract cannot cover this redemption');
  }
  return gross * (1 - f);
}

export interface RewardResult {
  /** Total staked after the rewards were added. */
  totalStaked: number;
  /** The rate after the rewards were added. */
  rate: number;
  /** The rate before, so the caller can report the change. */
  previousRate: number;
}

/**
 * Add staking rewards to the pool, raising the exchange rate.
 *
 * Rewards are real TGR the caller has already moved into the contract. The
 * function refuses a negative amount, and refuses rewards when there are no
 * shares: adding to an empty pool would create value from nothing and hand it
 * to the first depositor.
 */
export function applyRewards(state: LiquidStakeState, rewards: number): RewardResult {
  const amount = Number(rewards);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AmmError('INVALID_REWARDS', 'rewards must be a non-negative finite number');
  }
  if (state.totalShares === 0 && amount > 0) {
    throw new AmmError('NO_SHARES', 'cannot distribute rewards while no stTGR is outstanding');
  }
  const previousRate = exchangeRate(state);
  const totalStaked = Number(state.totalStaked) + amount;
  return { totalStaked, rate: totalStaked / state.totalShares, previousRate };
}

/**
 * Annual percentage yield implied by a reward amount over a period.
 *
 * `periodSeconds` is the window the rewards cover; the result is annualised so
 * a dashboard can show a comparable figure. Simple annualisation, not
 * compounding, because the staking rewards are not restaked automatically.
 */
export function impliedApy(totalStaked: number, rewards: number, periodSeconds: number): number {
  const staked = requirePositive(totalStaked, 'totalStaked');
  const amount = Number(rewards);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AmmError('INVALID_REWARDS', 'rewards must be a non-negative finite number');
  }
  const period = requirePositive(periodSeconds, 'periodSeconds');
  const secondsPerYear = 365 * 24 * 60 * 60;
  return (amount / staked) * (secondsPerYear / period);
}
