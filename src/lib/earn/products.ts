/**
 * Earn product math: flexible and locked staking, the native yield vault, dual
 * investment and shark fin payoff.
 *
 * Accrual is simple (non-compounding) interest per the product's APR, except
 * for the vault which compounds. All functions fail closed on non-finite or
 * non-positive inputs.
 */

export type EarnProductType =
  | 'flexible'
  | 'locked'
  | 'vault'
  | 'dual_investment'
  | 'shark_fin'
  | 'auto_invest'
  | 'launchpool'
  | 'defi_staking';

/**
 * Reward accrued on a principal over an elapsed period at a simple APR.
 *
 * Used for flexible and locked products. `elapsedNs` is wall-clock time since
 * the subscription started or the last accrual.
 */
export function accrueSimple(principal: number, apr: number, elapsedNs: number): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(apr) || apr <= 0) return 0;
  if (!Number.isFinite(elapsedNs) || elapsedNs <= 0) return 0;
  const yearNs = 365 * 24 * 60 * 60 * 1e9;
  const fraction = Math.min(elapsedNs / yearNs, 1);
  return principal * apr * fraction;
}

/**
 * Reward accrued on a compounding vault position.
 *
 * Compounding is applied per second so the result is continuous rather than
 * stepped, matching an auto-compounding vault.
 */
export function accrueCompounded(principal: number, apr: number, elapsedNs: number): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(apr) || apr <= 0) return 0;
  if (!Number.isFinite(elapsedNs) || elapsedNs <= 0) return 0;
  const yearNs = 365 * 24 * 60 * 60 * 1e9;
  const t = Math.min(elapsedNs / yearNs, 1);
  return principal * (Math.exp(apr * t) - 1);
}

/** Whether a locked subscription may be redeemed at `nowNs`. */
export function lockedRedeemable(
  startedNs: number,
  durationDays: number,
  nowNs: number,
): boolean {
  if (!Number.isFinite(startedNs) || !Number.isFinite(durationDays) || durationDays <= 0) return false;
  const dayNs = 24 * 60 * 60 * 1e9;
  return Number.isFinite(nowNs) && nowNs - startedNs >= durationDays * dayNs;
}

export interface DualInvestmentInput {
  /** Notional the user commits. */
  amount: number;
  /** Annualised yield offered for the term. */
  apy: number;
  /** Strike at which the conversion happens. */
  strike: number;
  /** Spot at settlement. */
  settlementPrice: number;
  /** True for buy-low (converts to base when spot <= strike). */
  direction: 'buy_low' | 'sell_high';
  termDays: number;
}

export interface DualInvestmentResult {
  /** Yield earned regardless of conversion. */
  reward: number;
  /** Asset the user receives at settlement: the quote or the base asset. */
  settlementAsset: 'quote' | 'base';
  /** Amount of the settlement asset returned. */
  payout: number;
}

/**
 * Settle a dual investment product.
 *
 * Buy-low converts the notional into the base asset at the strike when the
 * settlement price is at or below the strike, otherwise the user keeps the
 * quote plus the yield. Sell-high is the mirror. The yield is always paid.
 */
export function settleDualInvestment(input: DualInvestmentInput): DualInvestmentResult | { error: string } {
  const { amount, apy, strike, settlementPrice, termDays } = input;
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'amount must be a positive number' };
  if (!Number.isFinite(apy) || apy < 0) return { error: 'apy must be non-negative' };
  if (!Number.isFinite(strike) || strike <= 0) return { error: 'strike must be a positive number' };
  if (!Number.isFinite(settlementPrice) || settlementPrice <= 0) {
    return { error: 'settlementPrice must be a positive number' };
  }
  if (!Number.isFinite(termDays) || termDays <= 0) return { error: 'termDays must be positive' };

  const reward = amount * apy * (termDays / 365);
  const converted =
    input.direction === 'buy_low'
      ? settlementPrice <= strike
      : settlementPrice >= strike;

  if (!converted) {
    return { reward, settlementAsset: 'quote', payout: amount + reward };
  }
  return { reward, settlementAsset: 'base', payout: (amount + reward) / strike };
}

export interface SharkFinInput {
  amount: number;
  /** Minimum guaranteed yield over the term, as a fraction of notional. */
  minYield: number;
  /** Maximum yield, paid when settlement is inside the range. */
  maxYield: number;
  /** Lower bound of the yield range. */
  lowerBound: number;
  /** Upper bound of the yield range. */
  upperBound: number;
  settlementPrice: number;
}

export interface SharkFinResult {
  /** Yield as a fraction of notional, between minYield and maxYield. */
  yieldFraction: number;
  payout: number;
  inRange: boolean;
}

/**
 * Settle a shark fin product.
 *
 * The principal is protected: the payout is never below the notional. The
 * yield is the minimum outside the range and the maximum inside it. A range
 * that is inverted or a settlement below the lower bound both resolve to the
 * minimum, never to a negative payout.
 */
export function settleSharkFin(input: SharkFinInput): SharkFinResult | { error: string } {
  const { amount, minYield, maxYield, lowerBound, upperBound, settlementPrice } = input;
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'amount must be a positive number' };
  if (!Number.isFinite(minYield) || minYield < 0) return { error: 'minYield must be non-negative' };
  if (!Number.isFinite(maxYield) || maxYield < minYield) {
    return { error: 'maxYield must be at least minYield' };
  }
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound) || lowerBound >= upperBound) {
    return { error: 'lowerBound must be less than upperBound' };
  }
  if (!Number.isFinite(settlementPrice) || settlementPrice <= 0) {
    return { error: 'settlementPrice must be a positive number' };
  }

  const inRange = settlementPrice >= lowerBound && settlementPrice <= upperBound;
  const yieldFraction = inRange ? maxYield : minYield;
  return { yieldFraction, payout: amount * (1 + yieldFraction), inRange };
}

/**
 * Split a launchpool reward pool across stakers by their stake weight.
 *
 * Each staker receives `stake / totalStake` of the pool. When the total stake
 * is zero the pool is not distributed rather than divided by zero.
 */
export function launchpoolReward(
  stake: number,
  totalStake: number,
  rewardPool: number,
): number {
  if (!Number.isFinite(stake) || stake <= 0) return 0;
  if (!Number.isFinite(totalStake) || totalStake <= 0) return 0;
  if (!Number.isFinite(rewardPool) || rewardPool <= 0) return 0;
  return (stake / totalStake) * rewardPool;
}
