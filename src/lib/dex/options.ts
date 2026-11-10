/**
 * TigerSwap options AMM.
 *
 * A pool of settlement collateral writes cash-settled options against a single
 * underlying. The premium is the Black-Scholes value of the contract, so the
 * price a trader pays is the model price rather than a market maker's quote.
 * Because the pool is the counterparty, it must be able to honour the worst
 * case: every written contract reserves its maximum payout out of the pool, and
 * a write is refused when the pool cannot cover it. That reservation is what
 * keeps a winning option from minting collateral nobody posted.
 *
 * The module is pure. It prices, sizes and settles; the service layer moves the
 * balances.
 */

import { AmmError, requirePositive } from '@/lib/dex/amm';
import { blackScholes, settlementValue } from '@/lib/options/pricing';

export type OptionType = 'call' | 'put';

export const OPTION_TYPES: readonly OptionType[] = ['call', 'put'];

function requireNonNegative(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) throw new AmmError('INVALID_AMOUNT', `${name} must be a non-negative finite number`);
  return n;
}

function requireFraction(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) throw new AmmError('INVALID_RATE', `${name} must be a non-negative finite number`);
  return n;
}

export interface PremiumInput {
  type: OptionType;
  spot: number;
  strike: number;
  /** Time to expiry in years. */
  timeToExpiry: number;
  /** Annualised volatility as a fraction (0.6 = 60%). */
  volatility: number;
  /** Risk-free rate as a fraction. */
  riskFreeRate: number;
  /** Units of underlying per contract. */
  contractSize: number;
  /** Contracts being priced. */
  quantity: number;
}

export interface PremiumResult {
  /** Premium per contract, in settlement currency. */
  premiumPerContract: number;
  /** Total premium for `quantity` contracts. */
  premium: number;
  /** The model price of one unit of underlying, before the contract size. */
  unitPrice: number;
  delta: number;
}

/**
 * Price a trade of `quantity` contracts with Black-Scholes.
 *
 * The premium scales linearly with the contract size and the quantity, and the
 * per-unit price comes from the model, so the pool never invents a quote. A
 * non-positive spot, strike, volatility or contract size is refused rather than
 * producing a NaN premium.
 */
export function optionPremium(input: PremiumInput): PremiumResult {
  const spot = requirePositive(input.spot, 'spot');
  const strike = requirePositive(input.strike, 'strike');
  const volatility = requirePositive(input.volatility, 'volatility');
  const contractSize = requirePositive(input.contractSize, 'contractSize');
  const quantity = requirePositive(input.quantity, 'quantity');
  const timeToExpiry = requireNonNegative(input.timeToExpiry, 'timeToExpiry');
  const riskFreeRate = requireFraction(input.riskFreeRate, 'riskFreeRate');

  const priced = blackScholes({
    spot,
    strike,
    timeToExpiry,
    volatility,
    riskFreeRate,
    type: input.type,
  });
  if ('error' in priced) throw new AmmError('PRICING_FAILED', priced.error);

  const unitPrice = priced.price;
  const premiumPerContract = unitPrice * contractSize;
  return {
    premiumPerContract,
    premium: premiumPerContract * quantity,
    unitPrice,
    delta: priced.delta,
  };
}

/**
 * The maximum a written contract can pay the holder, in settlement currency.
 *
 * A put's payoff is bounded by the strike, because the spot cannot go below
 * zero. A call's payoff is unbounded unless a cap is set, so the pool quotes a
 * capped call: the payout is capped at `capPrice`, and the reserve is the
 * payoff at that cap. Reserving this figure is what makes the pool solvent.
 */
export function maxPayout(type: OptionType, strike: number, capPrice: number, contractSize: number): number {
  const s = requirePositive(strike, 'strike');
  const size = requirePositive(contractSize, 'contractSize');
  if (type === 'put') return s * size;
  const cap = requirePositive(capPrice, 'capPrice');
  if (cap <= s) throw new AmmError('INVALID_CAP', 'capPrice must exceed the strike for a call');
  return (cap - s) * size;
}

/** Collateral the pool must reserve to write `quantity` contracts. */
export function requiredReserve(
  type: OptionType,
  strike: number,
  capPrice: number,
  contractSize: number,
  quantity: number,
): number {
  return maxPayout(type, strike, capPrice, contractSize) * requirePositive(quantity, 'quantity');
}

export interface BuyQuoteInput {
  type: OptionType;
  spot: number;
  strike: number;
  capPrice: number;
  timeToExpiry: number;
  volatility: number;
  riskFreeRate: number;
  contractSize: number;
  quantity: number;
  /** Taker fee as a fraction of the premium. */
  feeRate: number;
  /** The pool's currently free collateral. */
  freeCollateral: number;
}

export interface BuyQuoteResult {
  premium: number;
  fee: number;
  /** Premium plus fee, what the buyer pays. */
  totalCost: number;
  /** Collateral the pool must reserve. */
  reserve: number;
  maxPayout: number;
}

/**
 * Quote a buy, refusing a size the pool cannot back.
 *
 * The check is on the reserve, not the premium: a pool with free collateral of
 * 100 can write at most 100 of worst-case payout regardless of how cheap the
 * option is. This is the fail-closed rule that stops the AMM writing an option
 * it could not settle.
 */
export function buyQuote(input: BuyQuoteInput): BuyQuoteResult {
  const free = requireNonNegative(input.freeCollateral, 'freeCollateral');
  const feeRate = requireFraction(input.feeRate, 'feeRate');
  if (feeRate >= 1) throw new AmmError('INVALID_FEE', 'feeRate must be a fraction below 1');

  const priced = optionPremium(input);
  const fee = priced.premium * feeRate;
  const reserve = requiredReserve(input.type, input.strike, input.capPrice, input.contractSize, input.quantity);
  if (reserve > free + 1e-9) {
    throw new AmmError('POOL_CAPACITY', 'the pool cannot reserve enough collateral for this trade');
  }
  const cap = maxPayout(input.type, input.strike, input.capPrice, input.contractSize);
  return {
    premium: priced.premium,
    fee,
    totalCost: priced.premium + fee,
    reserve,
    maxPayout: cap * input.quantity,
  };
}

/**
 * What a written contract pays the holder at settlement.
 *
 * The intrinsic value is capped at the contract's maximum payout, so a call
 * that finishes far above its cap pays the cap and no more. The pool reserved
 * exactly that cap, so the payout can never exceed what was set aside.
 */
export function settlementPayout(
  type: OptionType,
  strike: number,
  settlementPrice: number,
  contractSize: number,
  payoutCap: number,
): number {
  const size = requirePositive(contractSize, 'contractSize');
  const cap = requireNonNegative(payoutCap, 'payoutCap');
  const intrinsic = settlementValue(type, strike, settlementPrice, size);
  return Math.min(intrinsic, cap);
}

/**
 * Annualised yield the premium implies on the collateral reserved to write it.
 *
 * The writer's return is the premium over the collateral locked for the life of
 * the option, annualised by the time to expiry. A zero time to expiry yields
 * zero rather than an infinite rate.
 */
export function writerYield(premium: number, reserved: number, timeToExpiry: number): number {
  const p = requireNonNegative(premium, 'premium');
  const r = requirePositive(reserved, 'reserved');
  const t = requireNonNegative(timeToExpiry, 'timeToExpiry');
  if (t === 0) return 0;
  return (p / r) * (1 / t);
}

export { blackScholes, settlementValue };
