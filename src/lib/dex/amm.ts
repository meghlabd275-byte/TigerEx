/**
 * TigerSwap AMM core.
 *
 * Self-contained automated market maker mathematics for the four pool shapes
 * TigerSwap runs. Nothing here calls an external DEX SDK or router: V2 uses the
 * constant-product invariant, Stable uses the Curve-style amplifying invariant,
 * Weighted uses the Balancer-style power invariant, and Concentrated uses the
 * Uniswap-V3-style square-root-price step. The settlement engine and the C++
 * pricing path apply the same rules.
 *
 * All quantities are plain finite numbers and every entry point validates its
 * inputs. A non-finite, zero or negative reserve would otherwise propagate a
 * NaN through the invariant and mint a wrong amount of output, so it is rejected
 * rather than computed with.
 */

export class AmmError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Reject anything that is not a strictly positive finite number. */
export function requirePositive(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AmmError('INVALID_AMOUNT', `${name} must be a positive finite number`);
  }
  return n;
}

/** Reject anything that is not a finite number. */
export function requireFinite(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new AmmError('INVALID_AMOUNT', `${name} must be a finite number`);
  }
  return n;
}

/** A fee expressed as a fraction of the input; must sit in [0, 1). */
export function requireFee(fee: unknown): number {
  const n = typeof fee === 'number' ? fee : Number(fee);
  if (!Number.isFinite(n) || n < 0 || n >= 1) {
    throw new AmmError('INVALID_FEE', 'fee must be a fraction in [0, 1)');
  }
  return n;
}

// ============================================================================
// Constant-product pools (V2)
// ============================================================================

export interface V2Reserves {
  /** Reserve of the input token. */
  reserveIn: number;
  /** Reserve of the output token. */
  reserveOut: number;
}

/**
 * Output of a constant-product swap, fee taken from the input.
 *
 * `amountOut = reserveOut * amountInNet / (reserveIn + amountInNet)`, which is
 * exactly `k = x * y` preserved for the pool after the fee is skimmed.
 */
export function v2GetAmountOut(amountIn: number, reserves: V2Reserves, fee: number): number {
  const aIn = requirePositive(amountIn, 'amountIn');
  const rIn = requirePositive(reserves.reserveIn, 'reserveIn');
  const rOut = requirePositive(reserves.reserveOut, 'reserveOut');
  const f = requireFee(fee);

  const amountInNet = aIn * (1 - f);
  return (rOut * amountInNet) / (rIn + amountInNet);
}

/** Input required to receive a target output, fee included. */
export function v2GetAmountIn(amountOut: number, reserves: V2Reserves, fee: number): number {
  const aOut = requirePositive(amountOut, 'amountOut');
  const rIn = requirePositive(reserves.reserveIn, 'reserveIn');
  const rOut = requirePositive(reserves.reserveOut, 'reserveOut');
  const f = requireFee(fee);
  if (aOut >= rOut) {
    throw new AmmError('INSUFFICIENT_LIQUIDITY', 'requested output exceeds the pool reserve');
  }
  const numerator = rIn * aOut;
  const denominator = (rOut - aOut) * (1 - f);
  return numerator / denominator;
}

/** Spot price of the output token in units of the input token. */
export function v2SpotPrice(reserves: V2Reserves): number {
  const rIn = requirePositive(reserves.reserveIn, 'reserveIn');
  const rOut = requirePositive(reserves.reserveOut, 'reserveOut');
  return rOut / rIn;
}

/**
 * Price impact a constant-product swap of `amountIn` causes, as a fraction.
 *
 * It is the drop from the pool's spot price to the execution price the trade
 * actually achieves, so it is the number a slippage check and a MEV scorer both
 * want: a trade that moves the price 1% can be sandwiched for up to 1%. The fee
 * is not included — impact is about the reserves the trade consumes, and the
 * fee is accounted for separately.
 */
export function v2PriceImpact(amountIn: number, reserves: V2Reserves): number {
  const amount = requirePositive(amountIn, 'amountIn');
  const rIn = requirePositive(reserves.reserveIn, 'reserveIn');
  const rOut = requirePositive(reserves.reserveOut, 'reserveOut');

  const spotBefore = rOut / rIn;
  const spotAfter = rOut / (rIn + amount);
  return (spotBefore - spotAfter) / spotBefore;
}

/** The product invariant `k = x * y`, used to audit that a swap did not leak. */
export function v2Invariant(reserves: V2Reserves): number {
  return requirePositive(reserves.reserveIn, 'reserveIn') * requirePositive(reserves.reserveOut, 'reserveOut');
}

/** The constant-product invariant for a mint: `sqrt(x * y)` is the LP supply base. */
export function v2LiquidityFromAmounts(amount0: number, amount1: number): number {
  return Math.sqrt(requirePositive(amount0, 'amount0') * requirePositive(amount1, 'amount1'));
}

/**
 * LP tokens minted when liquidity is added to a V2 pool.
 *
 * The first deposit sets the supply to `sqrt(x * y)`; later deposits are capped
 * at the smaller proportional share so a deposit cannot be used to dilute the
 * pool by contributing an unbalanced pair.
 */
export function v2Mint(
  totalSupply: number,
  reserves: V2Reserves,
  amountIn: number,
  amountOut: number,
): { liquidity: number; amountInUsed: number; amountOutUsed: number } {
  const aIn = requirePositive(amountIn, 'amountIn');
  const aOut = requirePositive(amountOut, 'amountOut');
  const supply = requireFinite(totalSupply, 'totalSupply');
  if (supply < 0) throw new AmmError('INVALID_SUPPLY', 'totalSupply must not be negative');

  if (supply === 0) {
    return { liquidity: v2LiquidityFromAmounts(aIn, aOut), amountInUsed: aIn, amountOutUsed: aOut };
  }

  const rIn = requirePositive(reserves.reserveIn, 'reserveIn');
  const rOut = requirePositive(reserves.reserveOut, 'reserveOut');
  const liquidity = Math.min((aIn * supply) / rIn, (aOut * supply) / rOut);
  if (liquidity <= 0) {
    throw new AmmError('INSUFFICIENT_LIQUIDITY_MINTED', 'deposit is too small to mint liquidity');
  }
  return {
    liquidity,
    amountInUsed: (liquidity * rIn) / supply,
    amountOutUsed: (liquidity * rOut) / supply,
  };
}

/** Amounts returned when LP tokens are burned. */
export function v2Burn(
  totalSupply: number,
  reserves: V2Reserves,
  liquidity: number,
): { amountIn: number; amountOut: number } {
  const supply = requirePositive(totalSupply, 'totalSupply');
  const burn = requirePositive(liquidity, 'liquidity');
  if (burn > supply) throw new AmmError('INSUFFICIENT_LIQUIDITY_BURNED', 'cannot burn more than the supply');
  const rIn = requirePositive(reserves.reserveIn, 'reserveIn');
  const rOut = requirePositive(reserves.reserveOut, 'reserveOut');
  return { amountIn: (burn * rIn) / supply, amountOut: (burn * rOut) / supply };
}

// ============================================================================
// Stable pools (Curve-style invariant)
// ============================================================================

export interface StablePool {
  /** Amplification coefficient (typical range 1 .. 5000). */
  amplification: number;
  /** Balances, one per coin, in the same decimals. */
  balances: number[];
}

function requireStablePool(pool: StablePool): StablePool {
  if (!Array.isArray(pool.balances) || pool.balances.length < 2) {
    throw new AmmError('INVALID_POOL', 'a stable pool needs at least two coins');
  }
  const amp = requirePositive(pool.amplification, 'amplification');
  const balances = pool.balances.map((b, i) => requirePositive(b, `balances[${i}]`));
  return { amplification: amp, balances };
}

/**
 * The StableSwap invariant `D` for a set of balances.
 *
 * Solved by Newton's method as Curve does; the iteration is bounded and the
 * function throws rather than returning a partial value if it fails to converge,
 * because a wrong `D` silently misprices every subsequent swap.
 */
export function stableInvariant(balances: number[], amplification: number): number {
  const pool = requireStablePool({ balances, amplification });
  const n = pool.balances.length;
  const sum = pool.balances.reduce((acc, b) => acc + b, 0);

  const ann = pool.amplification * n;
  let d = sum;
  for (let i = 0; i < 256; i += 1) {
    let dProduct = d;
    for (const balance of pool.balances) {
      dProduct = (dProduct * d) / (balance * n);
    }
    const dPrevious = d;
    d = ((ann * sum + dProduct * n) * d) / ((ann - 1) * d + (n + 1) * dProduct);
    if (Math.abs(d - dPrevious) <= 1e-12 * d) return d;
  }
  throw new AmmError('INVARIANT_NOT_CONVERGED', 'stable invariant did not converge');
}

/**
 * Balance of coin `outIndex` after a swap that sets coin `inIndex` to `newIn`.
 */
export function stableGetY(
  balances: number[],
  amplification: number,
  inIndex: number,
  outIndex: number,
  newIn: number,
): number {
  const pool = requireStablePool({ balances, amplification });
  const n = pool.balances.length;
  if (inIndex < 0 || inIndex >= n || outIndex < 0 || outIndex >= n || inIndex === outIndex) {
    throw new AmmError('INVALID_INDEX', 'in/out coin indexes must be distinct and in range');
  }
  const x = requirePositive(newIn, 'newIn');
  const d = stableInvariant(pool.balances, pool.amplification);
  const ann = pool.amplification * n;

  let c = d;
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const balance = i === inIndex ? x : pool.balances[i];
    if (i === outIndex) continue;
    s += balance;
    c = (c * d) / (balance * n);
  }
  c = (c * d) / (ann * n);
  const b = s + d / ann;

  let y = d;
  for (let i = 0; i < 256; i += 1) {
    const yPrevious = y;
    y = (y * y + c) / (2 * y + b - d);
    if (Math.abs(y - yPrevious) <= 1e-12 * y) return y;
  }
  throw new AmmError('INVARIANT_NOT_CONVERGED', 'stable get_y did not converge');
}

export interface StableSwapResult {
  amountOut: number;
  /** The output coin balance after the swap, for the caller to persist. */
  newOutBalance: number;
  fee: number;
}

/**
 * Swap in a Stable pool with the fee taken from the input.
 *
 * `newIn = balanceIn + amountIn * (1 - fee)`, then the invariant is solved for
 * the output balance. The result is refused if the pool cannot honour it.
 */
export function stableSwap(
  pool: StablePool,
  inIndex: number,
  outIndex: number,
  amountIn: number,
  fee: number,
): StableSwapResult {
  const p = requireStablePool(pool);
  const aIn = requirePositive(amountIn, 'amountIn');
  const f = requireFee(fee);
  const netIn = aIn * (1 - f);
  const newIn = p.balances[inIndex] + netIn;
  const newOut = stableGetY(p.balances, p.amplification, inIndex, outIndex, newIn);
  const amountOut = p.balances[outIndex] - newOut;
  if (!Number.isFinite(amountOut) || amountOut <= 0) {
    throw new AmmError('INSUFFICIENT_LIQUIDITY', 'stable swap produced no output');
  }
  return { amountOut, newOutBalance: newOut, fee: aIn * f };
}

// ============================================================================
// Weighted pools (Balancer-style invariant)
// ============================================================================

export interface WeightedPool {
  /** Balances, one per token. */
  balances: number[];
  /** Weights, one per token, any positive values (normalised internally). */
  weights: number[];
  /** Swap fee fraction in [0, 1). */
  fee: number;
}

function requireWeightedPool(pool: WeightedPool): WeightedPool {
  if (!Array.isArray(pool.balances) || pool.balances.length < 2) {
    throw new AmmError('INVALID_POOL', 'a weighted pool needs at least two tokens');
  }
  if (!Array.isArray(pool.weights) || pool.weights.length !== pool.balances.length) {
    throw new AmmError('INVALID_POOL', 'weights and balances must be the same length');
  }
  const balances = pool.balances.map((b, i) => requirePositive(b, `balances[${i}]`));
  const weights = pool.weights.map((w, i) => requirePositive(w, `weights[${i}]`));
  return { balances, weights, fee: requireFee(pool.fee) };
}

/**
 * Output of a weighted-pool swap with the fee applied to the input.
 *
 * `amountOut = Bo * (1 - (Bi / (Bi + Ai))^(Wi / Wo))`.
 */
export function weightedGetAmountOut(
  pool: WeightedPool,
  inIndex: number,
  outIndex: number,
  amountIn: number,
): number {
  const p = requireWeightedPool(pool);
  const n = p.balances.length;
  if (inIndex < 0 || inIndex >= n || outIndex < 0 || outIndex >= n || inIndex === outIndex) {
    throw new AmmError('INVALID_INDEX', 'in/out token indexes must be distinct and in range');
  }
  const aIn = requirePositive(amountIn, 'amountIn');
  const netIn = aIn * (1 - p.fee);
  const bi = p.balances[inIndex];
  const bo = p.balances[outIndex];
  const ratio = bi / (bi + netIn);
  const exponent = p.weights[inIndex] / p.weights[outIndex];
  return bo * (1 - Math.pow(ratio, exponent));
}

/** Input required to receive `amountOut` from a weighted pool. */
export function weightedGetAmountIn(
  pool: WeightedPool,
  inIndex: number,
  outIndex: number,
  amountOut: number,
): number {
  const p = requireWeightedPool(pool);
  const n = p.balances.length;
  if (inIndex < 0 || inIndex >= n || outIndex < 0 || outIndex >= n || inIndex === outIndex) {
    throw new AmmError('INVALID_INDEX', 'in/out token indexes must be distinct and in range');
  }
  const aOut = requirePositive(amountOut, 'amountOut');
  const bi = p.balances[inIndex];
  const bo = p.balances[outIndex];
  if (aOut >= bo) throw new AmmError('INSUFFICIENT_LIQUIDITY', 'requested output exceeds the pool balance');
  const exponent = p.weights[outIndex] / p.weights[inIndex];
  const netIn = bi * (Math.pow(bo / (bo - aOut), exponent) - 1);
  return netIn / (1 - p.fee);
}

// ============================================================================
// Concentrated liquidity (V3-style, square-root price)
// ============================================================================

/** Tick to price: `1.0001 ^ tick`. */
export function tickToPrice(tick: number): number {
  if (!Number.isFinite(tick)) throw new AmmError('INVALID_TICK', 'tick must be finite');
  return Math.pow(1.0001, tick);
}

/** Price to the nearest tick whose price does not exceed it. */
export function priceToTick(price: number): number {
  const p = requirePositive(price, 'price');
  return Math.floor(Math.log(p) / Math.log(1.0001));
}

/** Tick to square-root price, the form the V3 step math uses. */
export function tickToSqrtPrice(tick: number): number {
  return Math.sqrt(tickToPrice(tick));
}

export interface V3PoolState {
  /** Current square-root price of token0 in token1. */
  sqrtPrice: number;
  /** Active liquidity in the current tick range. */
  liquidity: number;
  /** Lower bound of the active range (square-root price). */
  sqrtPriceLower: number;
  /** Upper bound of the active range (square-root price). */
  sqrtPriceUpper: number;
  /** Swap fee fraction in [0, 1). */
  fee: number;
}

export interface V3SwapResult {
  /** Gross amount of the input token consumed (fee included). */
  amountIn: number;
  /** Amount of the output token produced. */
  amountOut: number;
  /** Fee taken from the input. */
  feePaid: number;
  /** New square-root price after the swap. */
  sqrtPriceAfter: number;
  /** True when the swap stopped at the range boundary with input left over. */
  priceLimitReached: boolean;
}

function requireV3(state: V3PoolState): V3PoolState {
  const sqrtPrice = requirePositive(state.sqrtPrice, 'sqrtPrice');
  const liquidity = requirePositive(state.liquidity, 'liquidity');
  const lower = requirePositive(state.sqrtPriceLower, 'sqrtPriceLower');
  const upper = requirePositive(state.sqrtPriceUpper, 'sqrtPriceUpper');
  if (lower >= upper) throw new AmmError('INVALID_RANGE', 'lower bound must be below the upper bound');
  if (sqrtPrice < lower || sqrtPrice > upper) {
    throw new AmmError('PRICE_OUT_OF_RANGE', 'current price is outside the active range');
  }
  return { sqrtPrice, liquidity, sqrtPriceLower: lower, sqrtPriceUpper: upper, fee: requireFee(state.fee) };
}

/**
 * A single V3 swap step, bounded by the active range.
 *
 * Selling token0 (`zeroForOne`) walks the square-root price down; buying walks
 * it up. The step stops at the range boundary and reports `priceLimitReached`
 * so the caller can continue with the next range. The fee is charged on the
 * input before the price move, as the pool contract does.
 */
export function v3SwapStep(state: V3PoolState, zeroForOne: boolean, amountIn: number): V3SwapResult {
  const s = requireV3(state);
  const aIn = requirePositive(amountIn, 'amountIn');
  const netIn = aIn * (1 - s.fee);
  const l = s.liquidity;

  if (zeroForOne) {
    const invNext = 1 / s.sqrtPrice + netIn / l;
    const sqrtNext = 1 / invNext;
    const bounded = Math.max(sqrtNext, s.sqrtPriceLower);
    const netUsed = l * (1 / bounded - 1 / s.sqrtPrice);
    const amountOut = l * (s.sqrtPrice - bounded);
    const grossUsed = netUsed / (1 - s.fee);
    return {
      amountIn: grossUsed,
      amountOut,
      feePaid: grossUsed * s.fee,
      sqrtPriceAfter: bounded,
      priceLimitReached: bounded === s.sqrtPriceLower,
    };
  }

  const sqrtNext = s.sqrtPrice + netIn / l;
  const bounded = Math.min(sqrtNext, s.sqrtPriceUpper);
  const netUsed = l * (bounded - s.sqrtPrice);
  const amountOut = l * (1 / s.sqrtPrice - 1 / bounded);
  const grossUsed = netUsed / (1 - s.fee);
  return {
    amountIn: grossUsed,
    amountOut,
    feePaid: grossUsed * s.fee,
    sqrtPriceAfter: bounded,
    priceLimitReached: bounded === s.sqrtPriceUpper,
  };
}

/** Total token0/token1 backing a position of `liquidity` over a range. */
export function v3AmountsForLiquidity(
  liquidity: number,
  sqrtPrice: number,
  sqrtLower: number,
  sqrtUpper: number,
): { amount0: number; amount1: number } {
  const l = requirePositive(liquidity, 'liquidity');
  const p = requirePositive(sqrtPrice, 'sqrtPrice');
  const lo = requirePositive(sqrtLower, 'sqrtLower');
  const hi = requirePositive(sqrtUpper, 'sqrtUpper');
  if (lo >= hi) throw new AmmError('INVALID_RANGE', 'lower bound must be below the upper bound');
  if (p <= lo) return { amount0: l * (1 / lo - 1 / hi), amount1: 0 };
  if (p >= hi) return { amount0: 0, amount1: l * (hi - lo) };
  return { amount0: l * (1 / p - 1 / hi), amount1: l * (p - lo) };
}

/** Liquidity that a token0/token1 deposit backs over a range. */
export function v3LiquidityForAmounts(
  amount0: number,
  amount1: number,
  sqrtPrice: number,
  sqrtLower: number,
  sqrtUpper: number,
): number {
  const a0 = requireFinite(amount0, 'amount0');
  const a1 = requireFinite(amount1, 'amount1');
  const p = requirePositive(sqrtPrice, 'sqrtPrice');
  const lo = requirePositive(sqrtLower, 'sqrtLower');
  const hi = requirePositive(sqrtUpper, 'sqrtUpper');
  if (a0 < 0 || a1 < 0) throw new AmmError('INVALID_AMOUNT', 'amounts must not be negative');
  if (a0 === 0 && a1 === 0) throw new AmmError('INVALID_AMOUNT', 'at least one amount must be positive');
  if (lo >= hi) throw new AmmError('INVALID_RANGE', 'lower bound must be below the upper bound');

  if (p <= lo) return a0 / (1 / lo - 1 / hi);
  if (p >= hi) return a1 / (hi - lo);
  return Math.min(a0 / (1 / p - 1 / hi), a1 / (p - lo));
}

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Price impact of a swap, as a signed fraction of the spot price.
 *
 * Positive means the trader received a worse price than spot, which is the only
 * direction a constant-function pool can move the price.
 */
export function priceImpact(spotBefore: number, spotAfter: number): number {
  const before = requirePositive(spotBefore, 'spotBefore');
  const after = requirePositive(spotAfter, 'spotAfter');
  return (before - after) / before;
}

/** Execution price of a trade: output per unit of input. */
export function executionPrice(amountIn: number, amountOut: number): number {
  return requirePositive(amountOut, 'amountOut') / requirePositive(amountIn, 'amountIn');
}

/**
 * Impermanent loss for a two-asset pool, as a fraction of the hold value.
 *
 * `IL = 2 * sqrt(r) / (1 + r) - 1` where `r` is the price ratio after/before.
 * The result is negative (a loss) and is exactly 0 for `r = 1`.
 */
export function impermanentLoss(priceRatio: number): number {
  const r = requirePositive(priceRatio, 'priceRatio');
  return (2 * Math.sqrt(r)) / (1 + r) - 1;
}
