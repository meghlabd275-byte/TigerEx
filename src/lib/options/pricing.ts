/**
 * European option pricing and greeks (Black-Scholes).
 *
 * Used to price options at listing and to compute settlement value at expiry.
 * The model is standard; the guards around it are what matter: a non-positive
 * spot, strike, volatility or time returns an explicit error rather than a NaN
 * premium, and the normal CDF is computed without an external dependency.
 */

export interface OptionInput {
  spot: number;
  strike: number;
  /** Time to expiry in years. */
  timeToExpiry: number;
  /** Annualised volatility as a fraction (0.6 = 60%). */
  volatility: number;
  /** Risk-free rate as a fraction. */
  riskFreeRate: number;
  type: 'call' | 'put';
}

export interface OptionGreeks {
  price: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
}

/**
 * Standard normal cumulative distribution function, Abramowitz & Stegun 7.1.26.
 * Accurate to ~1e-7, which is well inside the tick size of any listed option.
 */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function blackScholes(input: OptionInput): OptionGreeks | { error: string } {
  const { spot, strike, timeToExpiry, volatility, riskFreeRate } = input;
  if (!Number.isFinite(spot) || spot <= 0) return { error: 'spot must be a positive number' };
  if (!Number.isFinite(strike) || strike <= 0) return { error: 'strike must be a positive number' };
  if (!Number.isFinite(volatility) || volatility <= 0) return { error: 'volatility must be positive' };
  if (!Number.isFinite(timeToExpiry) || timeToExpiry < 0) return { error: 'timeToExpiry must be non-negative' };
  if (!Number.isFinite(riskFreeRate)) return { error: 'riskFreeRate must be a finite number' };
  if (input.type !== 'call' && input.type !== 'put') return { error: 'type must be call or put' };

  const isCall = input.type === 'call';

  // At expiry the value is intrinsic only; the greeks collapse.
  if (timeToExpiry === 0) {
    const intrinsic = isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
    return {
      price: intrinsic,
      delta: isCall ? (spot > strike ? 1 : 0) : spot < strike ? -1 : 0,
      gamma: 0,
      vega: 0,
      theta: 0,
    };
  }

  const sqrtT = Math.sqrt(timeToExpiry);
  const d1 =
    (Math.log(spot / strike) + (riskFreeRate + (volatility * volatility) / 2) * timeToExpiry) /
    (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;
  const discount = Math.exp(-riskFreeRate * timeToExpiry);

  const price = isCall
    ? spot * normalCdf(d1) - strike * discount * normalCdf(d2)
    : strike * discount * normalCdf(-d2) - spot * normalCdf(-d1);

  const delta = isCall ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = normalPdf(d1) / (spot * volatility * sqrtT);
  const vega = (spot * normalPdf(d1) * sqrtT) / 100; // per 1% vol
  const theta = isCall
    ? (-(spot * normalPdf(d1) * volatility) / (2 * sqrtT) - riskFreeRate * strike * discount * normalCdf(d2)) / 365
    : (-(spot * normalPdf(d1) * volatility) / (2 * sqrtT) + riskFreeRate * strike * discount * normalCdf(-d2)) / 365;

  return { price: Math.max(price, 0), delta, gamma, vega, theta };
}

/**
 * Cash settlement value of an option at expiry.
 *
 * The holder receives the intrinsic value when it is positive; an out-of-the
 * money option settles at zero, never a negative payout.
 */
export function settlementValue(
  type: 'call' | 'put',
  strike: number,
  settlementPrice: number,
  contractSize = 1,
): number {
  if (!Number.isFinite(strike) || strike <= 0) return 0;
  if (!Number.isFinite(settlementPrice) || settlementPrice <= 0) return 0;
  const size = Number.isFinite(contractSize) && contractSize > 0 ? contractSize : 1;
  const intrinsic = type === 'call' ? settlementPrice - strike : strike - settlementPrice;
  return Math.max(intrinsic, 0) * size;
}

/**
 * Implied volatility by bisection on the Black-Scholes price.
 *
 * Bisection is chosen over Newton because it cannot diverge: the model price is
 * monotonic in volatility, so a bracketed search always converges. Returns null
 * when the target price is outside the arbitrage bounds.
 */
export function impliedVolatility(
  input: Omit<OptionInput, 'volatility'>,
  targetPrice: number,
): number | null {
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return null;

  const discount = Math.exp(-input.riskFreeRate * input.timeToExpiry);
  const intrinsic =
    input.type === 'call'
      ? Math.max(input.spot - input.strike * discount, 0)
      : Math.max(input.strike * discount - input.spot, 0);
  const upperBound = input.type === 'call' ? input.spot : input.strike * discount;
  if (targetPrice < intrinsic - 1e-9 || targetPrice > upperBound + 1e-9) return null;

  let low = 1e-4;
  let high = 5;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const priced = blackScholes({ ...input, volatility: mid });
    if ('error' in priced) return null;
    if (Math.abs(priced.price - targetPrice) < 1e-8) return mid;
    if (priced.price > targetPrice) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}
