/**
 * TigerSwap launchpad mathematics: bonding curves, IDO allocations and
 * liquidity-bootstrapping pools.
 *
 * A bonding curve prices a token continuously as its supply is minted, so a
 * meme launch has a real price at every point rather than a fixed sale price.
 * The IDO allocator distributes a fixed supply across stakers by weight, and the
 * LBP computes the time-varying weight that lets a fair launch discover a price.
 * Everything is pure and validated.
 */

import { AmmError } from '@/lib/dex/amm';

export type CurveKind = 'linear' | 'exponential';

export interface BondingCurve {
  kind: CurveKind;
  /** Price of the very first unit. */
  basePrice: number;
  /** Slope (linear) or growth factor (exponential) of the curve. */
  slope: number;
}

/**
 * Price of the next token when `supply` tokens have already been sold.
 *
 * Linear: `basePrice + slope * supply`. Exponential:
 * `basePrice * slope ^ (supply / scale)`. Both are strictly increasing, so the
 * curve can only ever reward early buyers, never the reverse.
 */
export function bondingPrice(curve: BondingCurve, supply: number, scale = 1): number {
  if (!Number.isFinite(curve.basePrice) || curve.basePrice <= 0) {
    throw new AmmError('INVALID_PRICE', 'basePrice must be positive');
  }
  if (!Number.isFinite(curve.slope) || curve.slope <= 0) {
    throw new AmmError('INVALID_SLOPE', 'slope must be positive');
  }
  if (!Number.isFinite(supply) || supply < 0) {
    throw new AmmError('INVALID_SUPPLY', 'supply must not be negative');
  }
  if (curve.kind === 'linear') {
    return curve.basePrice + curve.slope * supply;
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new AmmError('INVALID_SCALE', 'scale must be positive');
  return curve.basePrice * Math.pow(curve.slope, supply / scale);
}

/**
 * Cost of buying `amount` tokens from the curve starting at `supply`.
 *
 * Integrates the price over the purchase. The linear integral is exact; the
 * exponential integral is `basePrice * (slope^(b/scale) - slope^(a/scale)) /
 * ln(slope)` when the growth factor is not 1, and `basePrice * amount` when it
 * is. A closed form is used so a large purchase is not mispriced by a coarse
 * numeric sum.
 */
export function bondingBuyCost(
  curve: BondingCurve,
  supply: number,
  amount: number,
  scale = 1,
  fee = 0,
): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new AmmError('INVALID_AMOUNT', 'amount must be positive');
  if (!Number.isFinite(supply) || supply < 0) throw new AmmError('INVALID_SUPPLY', 'supply must not be negative');
  if (!Number.isFinite(fee) || fee < 0 || fee >= 1) throw new AmmError('INVALID_FEE', 'fee must be a fraction in [0, 1)');
  let base: number;
  if (curve.kind === 'linear') {
    base = curve.basePrice * amount + curve.slope * (supply * amount + (amount * amount) / 2);
  } else {
    if (!Number.isFinite(scale) || scale <= 0) throw new AmmError('INVALID_SCALE', 'scale must be positive');
    const growth = curve.slope;
    const end = supply + amount;
    if (growth === 1) {
      base = curve.basePrice * amount;
    } else {
      base =
        (curve.basePrice * scale * (Math.pow(growth, end / scale) - Math.pow(growth, supply / scale))) /
        Math.log(growth);
    }
  }
  return base * (1 + fee);
}

/**
 * Tokens a buyer receives for a fixed budget, found by inverting the cost.
 *
 * The inversion uses bisection on the monotonic cost function, bounded to the
 * curve's sold supply, so a budget that cannot buy a full token still yields a
 * fractional amount rather than zero.
 */
export function bondingTokensForBudget(
  curve: BondingCurve,
  supply: number,
  budget: number,
  scale = 1,
  maxSupply = 1e9,
  fee = 0,
): number {
  if (!Number.isFinite(budget) || budget <= 0) throw new AmmError('INVALID_AMOUNT', 'budget must be positive');
  let low = 0;
  let high = maxSupply;
  if (bondingBuyCost(curve, supply, high, scale, fee) < budget) {
    throw new AmmError('INSUFFICIENT_SUPPLY', 'the curve cannot absorb this budget');
  }
  for (let i = 0; i < 128; i += 1) {
    const mid = (low + high) / 2;
    if (bondingBuyCost(curve, supply, mid, scale, fee) < budget) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Amount returned when selling `amount` tokens back into the curve.
 *
 * The proceeds are the integral below the current supply, so selling always
 * returns strictly less than buying the same amount, which is what prevents a
 * round trip from draining the curve.
 */
export function bondingSellProceeds(
  curve: BondingCurve,
  supply: number,
  amount: number,
  scale = 1,
  fee = 0,
): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new AmmError('INVALID_AMOUNT', 'amount must be positive');
  if (amount > supply) throw new AmmError('INSUFFICIENT_SUPPLY', 'cannot sell more than was sold');
  const gross = bondingBuyCost(curve, supply - amount, amount, scale);
  return gross * (1 - fee);
}

// ============================================================================
// IDO allocation
// ============================================================================

export interface AllocationEntry {
  userId: string;
  /** Stake weight that determines the share of the sale. */
  weight: number;
}

export interface AllocationResult {
  userId: string;
  weight: number;
  /** Share of the total weight, a fraction in [0, 1]. */
  share: number;
  /** Tokens allocated to this participant. */
  tokens: number;
  /** Quote currency owed by this participant. */
  cost: number;
}

/**
 * Distribute a fixed token supply across weighted participants.
 *
 * Each participant receives their weight share of the supply, priced at the
 * sale price. The final participant absorbs the rounding remainder so the
 * allocations sum exactly to the supply; a sale that under- or over-allocated
 * would leave tokens stranded or oversold.
 */
export function allocateIdo(
  entries: AllocationEntry[],
  totalTokens: number,
  pricePerToken: number,
): AllocationResult[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AmmError('NO_PARTICIPANTS', 'at least one participant is required');
  }
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    throw new AmmError('INVALID_SUPPLY', 'totalTokens must be positive');
  }
  if (!Number.isFinite(pricePerToken) || pricePerToken <= 0) {
    throw new AmmError('INVALID_PRICE', 'pricePerToken must be positive');
  }
  const totalWeight = entries.reduce((acc, e) => {
    if (!Number.isFinite(e.weight) || e.weight < 0) {
      throw new AmmError('INVALID_WEIGHT', 'weights must not be negative');
    }
    return acc + e.weight;
  }, 0);
  if (totalWeight <= 0) throw new AmmError('NO_WEIGHT', 'total weight must be positive');

  const results: AllocationResult[] = [];
  let allocated = 0;
  entries.forEach((entry, index) => {
    const share = entry.weight / totalWeight;
    const tokens = index === entries.length - 1 ? totalTokens - allocated : totalTokens * share;
    allocated += tokens;
    results.push({ userId: entry.userId, weight: entry.weight, share, tokens, cost: tokens * pricePerToken });
  });
  return results;
}

// ============================================================================
// Liquidity bootstrapping pool
// ============================================================================

export interface LbpConfig {
  /** Weight of the project token at the start, a fraction in (0, 1). */
  startWeight: number;
  /** Weight of the project token at the end, a fraction in (0, 1). */
  endWeight: number;
  startAt: number;
  endAt: number;
}

/** The project-token weight at a point in time, interpolated linearly. */
export function lbpWeightAt(config: LbpConfig, now: number): number {
  if (!Number.isFinite(config.startWeight) || config.startWeight <= 0 || config.startWeight >= 1) {
    throw new AmmError('INVALID_WEIGHT', 'startWeight must be a fraction in (0, 1)');
  }
  if (!Number.isFinite(config.endWeight) || config.endWeight <= 0 || config.endWeight >= 1) {
    throw new AmmError('INVALID_WEIGHT', 'endWeight must be a fraction in (0, 1)');
  }
  if (config.endAt <= config.startAt) {
    throw new AmmError('INVALID_TIME', 'endAt must be after startAt');
  }
  if (now <= config.startAt) return config.startWeight;
  if (now >= config.endAt) return config.endWeight;
  const progress = (now - config.startAt) / (config.endAt - config.startAt);
  return config.startWeight + (config.endWeight - config.startWeight) * progress;
}

/**
 * Spot price of an LBP from its weights and balances.
 *
 * `price = (balanceQuote / weightQuote) / (balanceProject / weightProject)`,
 * the Balancer weighted-pool spot price, so the falling project weight makes the
 * price fall over time even with no trades.
 */
export function lbpSpotPrice(
  balanceProject: number,
  balanceQuote: number,
  weightProject: number,
): number {
  if (!Number.isFinite(balanceProject) || balanceProject <= 0) {
    throw new AmmError('INVALID_BALANCE', 'project balance must be positive');
  }
  if (!Number.isFinite(balanceQuote) || balanceQuote <= 0) {
    throw new AmmError('INVALID_BALANCE', 'quote balance must be positive');
  }
  if (!Number.isFinite(weightProject) || weightProject <= 0 || weightProject >= 1) {
    throw new AmmError('INVALID_WEIGHT', 'project weight must be a fraction in (0, 1)');
  }
  const weightQuote = 1 - weightProject;
  return balanceQuote / weightQuote / (balanceProject / weightProject);
}
