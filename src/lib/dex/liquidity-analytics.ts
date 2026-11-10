/**
 * TigerSwap liquidity-provider analytics.
 *
 * The figures a provider needs to judge a position: the share of a pool the LP
 * tokens represent, the value of that share, the fees it earns from settled
 * swaps, the annualised return those fees imply, and the divergence loss the
 * position has taken against simply holding the two tokens.
 *
 * The module is pure. The service reads the pool and swap rows and passes the
 * numbers in, so the math can be tested without a database.
 */

import { AmmError, impermanentLoss } from '@/lib/dex/amm';

const YEAR_DAYS = 365;

function requireNonNegative(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) throw new AmmError('INVALID_AMOUNT', `${name} must be a non-negative finite number`);
  return n;
}

/** A provider's share of a pool, from their LP tokens and the pool's supply. */
export function positionShare(liquidity: number, totalSupply: number): number {
  const held = requireNonNegative(liquidity, 'liquidity');
  const supply = requireNonNegative(totalSupply, 'totalSupply');
  if (supply <= 0) return 0;
  return Math.min(1, held / supply);
}

/**
 * The annualised fee return of a pool from its trailing 24-hour fees.
 *
 * Fees are distributed pro rata, so every provider in a pool earns the same
 * rate and the share is not a parameter. The 24-hour run-rate is extrapolated
 * to a year and expressed as a fraction of the pool's value. A pool with no
 * value has no meaningful rate and returns 0 rather than dividing by zero.
 */
export function poolFeeApr(fee24hUsd: number, tvlUsd: number): number {
  const fee = requireNonNegative(fee24hUsd, 'fee24hUsd');
  const tvl = requireNonNegative(tvlUsd, 'tvlUsd');
  if (tvl <= 0) return 0;
  return (fee * YEAR_DAYS) / tvl;
}

/**
 * The effective annual yield of a fee return compounded continuously.
 *
 * A pool's fees accrue to the position, so reinvesting them compounds. The
 * conversion is `e^apr - 1`, the same convention the auto-compounding vaults
 * use, and it is monotonic so a negative APR yields a negative APY.
 */
export function aprToApy(apr: number): number {
  const rate = Number(apr);
  if (!Number.isFinite(rate)) throw new AmmError('INVALID_RATE', 'apr must be a finite number');
  return Math.expm1(rate);
}

/** The value of a provider's share of a pool, in the pool's quote asset. */
export function positionValueUsd(liquidity: number, totalSupply: number, tvlUsd: number): number {
  return positionShare(liquidity, totalSupply) * requireNonNegative(tvlUsd, 'tvlUsd');
}

/** Fees a position earned over `days`, from the pool's trailing 24-hour fees. */
export function positionFeesUsd(liquidity: number, totalSupply: number, fee24hUsd: number, days = 1): number {
  const span = requireNonNegative(days, 'days');
  return positionShare(liquidity, totalSupply) * requireNonNegative(fee24hUsd, 'fee24hUsd') * span;
}

/**
 * Divergence loss for a two-token constant-product position.
 *
 * `priceRatio` is the current price of one token divided by its price when the
 * position was opened. The result is a fraction of the position's value:
 * negative for a loss, exactly 0 when the price is unchanged. The formula only
 * holds for a constant-product pool, so the caller decides when it applies.
 */
export function divergenceLoss(priceRatio: number): number {
  return impermanentLoss(priceRatio);
}

/**
 * The price ratio a constant-product pool's reserves imply.
 *
 * For `x * y = k` the marginal price of the first token in the second is
 * `reserve1 / reserve0`, so the ratio of a pool's reserves is the ratio of its
 * current price to a past one. A non-positive reserve is refused rather than
 * yielding an infinite or NaN ratio.
 */
export function reservePriceRatio(reserve0: number, reserve1: number): number {
  const r0 = requireNonNegative(reserve0, 'reserve0');
  const r1 = requireNonNegative(reserve1, 'reserve1');
  if (r0 <= 0 || r1 <= 0) throw new AmmError('INVALID_RESERVE', 'both reserves must be positive to imply a price');
  return r1 / r0;
}
