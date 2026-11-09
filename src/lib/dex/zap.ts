/**
 * TigerSwap single-asset zap.
 *
 * A zap turns a deposit of one token into a balanced liquidity position in a
 * two-token pool: part of the input is swapped for the other token and both
 * sides are then deposited. The split has to be solved, not guessed — swap too
 * little and the second side is short, swap too much and the first side is, and
 * either way the excess is left idle instead of earning fees.
 *
 * Two solvers are provided. `zapSplitV2` is the closed-form solution for a
 * constant-product pool, where the amount to swap is the positive root of a
 * quadratic. `zapSplit` solves the same balance condition for any pool shape by
 * bisection on a caller-supplied quote function, which is what the settlement
 * path uses for stable, weighted and concentrated pools. Both take the fee from
 * the input, so the result matches what the router will actually deliver.
 */

import { AmmError, requirePositive, requireFee, v2GetAmountOut, type V2Reserves } from '@/lib/dex/amm';

export interface ZapInPlan {
  /** Amount of the input token swapped for the other side. */
  swapIn: number;
  /** Amount of the input token deposited directly. */
  depositIn: number;
  /** Amount of the output token received from the swap and deposited. */
  depositOut: number;
  /** Total of the input token consumed (swapIn + depositIn). */
  consumed: number;
  /** Residual input left over because of rounding; never negative. */
  dust: number;
}

function requireRatio(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AmmError('INVALID_RESERVE', `${name} must be a positive finite number`);
  }
  return n;
}

/**
 * Closed-form zap split for a constant-product pool.
 *
 * With input `A` of token A, pool reserves `rA`/`rB`, and fee `f`, the swap
 * amount `x` that leaves the two deposits in the pool's own ratio is the
 * positive root of
 *
 *   x² + x·(rA·(1 + 1/k) − A) − A·rA/k = 0,   k = 1 − f
 *
 * because the residual `A − x` and the swapped-out `y = rB·x·k/(rA + x·k)` must
 * satisfy `(A − x)/y = rA/rB`. The constant term is negative, so the quadratic
 * has exactly one positive root, which is the one returned.
 */
export function zapSplitV2(amountIn: number, reserves: V2Reserves, fee: number): ZapInPlan {
  const amount = requirePositive(amountIn, 'amountIn');
  const rA = requireRatio(reserves.reserveIn, 'reserveIn');
  const rB = requireRatio(reserves.reserveOut, 'reserveOut');
  const f = requireFee(fee);
  const k = 1 - f;

  // x² + B·x + C = 0
  const B = rA * (1 + 1 / k) - amount;
  const C = -(amount * rA) / k;
  const disc = B * B - 4 * C;
  // The discriminant is a sum of squares plus a positive term, so it cannot be
  // negative; guard anyway so a NaN cannot slip through if a caller mutates the
  // reserve object after validation.
  if (!Number.isFinite(disc) || disc < 0) {
    throw new AmmError('ZAP_UNSOLVABLE', 'the zap split has no real solution');
  }
  const root = (-B + Math.sqrt(disc)) / 2;
  const swapIn = Math.min(Math.max(root, 0), amount);
  // A zero swap is a valid outcome for a tiny input; the AMM quote rejects a
  // zero amount, so it is short-circuited rather than allowed to throw.
  const swapOut = swapIn > 0 ? v2GetAmountOut(swapIn, { reserveIn: rA, reserveOut: rB }, f) : 0;
  const depositIn = amount - swapIn;

  return {
    swapIn,
    depositIn,
    depositOut: swapOut,
    consumed: amount,
    dust: 0,
  };
}

/**
 * Zap split for any pool shape.
 *
 * `quoteOut` must return the output-token amount the router would deliver for a
 * given input-token amount, fee included. The balance condition
 *
 *   (amount − x)·ratioOut − quoteOut(x)·ratioIn = 0
 *
 * is strictly decreasing in `x` — the residual input falls and the quoted output
 * rises — so it has at most one root and bisection finds it. `ratioIn`/`ratioOut`
 * are the pool's target weights (its reserves for a constant-product or stable
 * pool, its weight vector for a weighted pool).
 */
export function zapSplit(
  amountIn: number,
  ratioIn: number,
  ratioOut: number,
  quoteOut: (swapIn: number) => number,
  iterations = 80,
): ZapInPlan {
  const amount = requirePositive(amountIn, 'amountIn');
  const rIn = requireRatio(ratioIn, 'ratioIn');
  const rOut = requireRatio(ratioOut, 'ratioOut');
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new AmmError('INVALID_ITERATIONS', 'iterations must be a positive integer');
  }

  const balance = (x: number): number => {
    // A zero swap quotes to zero; the AMM's quote functions reject a zero input,
    // so the endpoint is handled here rather than thrown out of the solver.
    const out = x > 0 ? quoteOut(x) : 0;
    return (amount - x) * rOut - out * rIn;
  };

  let low = 0;
  let high = amount;
  // balance(0) = amount·rOut > 0 and balance(amount) = −quoteOut·rIn < 0, so the
  // sign change is guaranteed and bisection is safe without a search phase.
  if (balance(0) <= 0) {
    // The whole input is already past the balance point; swap nothing.
    return { swapIn: 0, depositIn: amount, depositOut: 0, consumed: amount, dust: 0 };
  }
  for (let i = 0; i < iterations; i += 1) {
    const mid = (low + high) / 2;
    if (balance(mid) > 0) low = mid;
    else high = mid;
  }
  const swapIn = (low + high) / 2;
  const depositOut = quoteOut(swapIn);
  const depositIn = amount - swapIn;

  return { swapIn, depositIn, depositOut, consumed: amount, dust: 0 };
}

/**
 * Amounts returned when a single-asset withdrawal is zapped out of a pool.
 *
 * The LP's proportional share of each reserve is computed, then one side is
 * swapped back into the requested output token. `totalSupply` must be the pool's
 * LP supply including the position being burned.
 */
export function zapOutAmounts(
  lpAmount: number,
  totalSupply: number,
  reserves: { reserveIn: number; reserveOut: number },
  outputToken: 'in' | 'out',
  fee: number,
): { amountIn: number; amountOut: number; proceeds: number } {
  const lp = requirePositive(lpAmount, 'lpAmount');
  const supply = requirePositive(totalSupply, 'totalSupply');
  const rIn = requireRatio(reserves.reserveIn, 'reserveIn');
  const rOut = requireRatio(reserves.reserveOut, 'reserveOut');
  const f = requireFee(fee);
  if (lp > supply) {
    throw new AmmError('INSUFFICIENT_LIQUIDITY', 'lpAmount exceeds totalSupply');
  }

  const share = lp / supply;
  const amountIn = rIn * share;
  const amountOut = rOut * share;

  if (outputToken === 'in') {
    const swapped = v2GetAmountOut(amountOut, { reserveIn: rOut, reserveOut: rIn }, f);
    return { amountIn, amountOut, proceeds: amountIn + swapped };
  }
  const swapped = v2GetAmountOut(amountIn, { reserveIn: rIn, reserveOut: rOut }, f);
  return { amountIn, amountOut, proceeds: amountOut + swapped };
}
