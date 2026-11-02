/**
 * Validation for spot market listings.
 *
 * Kept free of `next/server` so the rules can be exercised directly by the
 * logic test runner. The admin route is a thin wrapper: it authenticates,
 * calls `validatePairInput`, writes the row and appends the audit entry.
 */

export const SYMBOL_RE = /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/;

export interface PairInput {
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  status: string;
  minPrice: number;
  maxPrice: number;
  tickSize: number;
  minQuantity: number;
  maxQuantity: number;
  minNotional: number;
  makerFee: number;
  takerFee: number;
}

export type PairValidation = { pair: PairInput } | { error: string };

function asPositiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Validate a listing request.
 *
 * Returns the normalized record or a message explaining why it cannot trade.
 * The checks are deliberately strict: a pair persisted with a zero tick size
 * or inverted bounds would reject every order at runtime, and a fee outside
 * [0, 1) would either pay the trader or seize the whole notional.
 */
export function validatePairInput(body: Record<string, unknown>): PairValidation {
  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return { error: 'symbol must be of the form BASE/QUOTE, for example BTC/USDT' };
  }

  const [base, quote] = symbol.split('/');
  if (base === quote) return { error: 'base and quote assets must differ' };

  // The asset codes must agree with the symbol, so a pair cannot be listed
  // under a name that contradicts its own legs.
  const baseCurrency = String(body.baseCurrency ?? base).trim().toUpperCase();
  const quoteCurrency = String(body.quoteCurrency ?? quote).trim().toUpperCase();
  if (baseCurrency !== base || quoteCurrency !== quote) {
    return { error: 'baseCurrency/quoteCurrency must match the symbol legs' };
  }

  const status = String(body.status ?? 'active').toLowerCase();
  if (!['active', 'paused', 'delisting'].includes(status)) {
    return { error: 'status must be one of active, paused, delisting' };
  }

  const tickSize = asPositiveNumber(body.tickSize);
  const minPrice = asPositiveNumber(body.minPrice);
  const maxPrice = asPositiveNumber(body.maxPrice);
  const minQuantity = asPositiveNumber(body.minQuantity);
  const maxQuantity = asPositiveNumber(body.maxQuantity);
  const minNotional = asPositiveNumber(body.minNotional ?? 1);

  if (tickSize === null) return { error: 'tickSize must be a positive number' };
  if (minPrice === null || maxPrice === null) return { error: 'minPrice and maxPrice must be positive' };
  if (minPrice >= maxPrice) return { error: 'minPrice must be less than maxPrice' };
  if (minQuantity === null || maxQuantity === null) {
    return { error: 'minQuantity and maxQuantity must be positive' };
  }
  if (minQuantity >= maxQuantity) return { error: 'minQuantity must be less than maxQuantity' };
  if (minNotional === null) return { error: 'minNotional must be a positive number' };

  const makerFee = Number(body.makerFee ?? 0.001);
  const takerFee = Number(body.takerFee ?? 0.001);
  for (const [name, fee] of [['makerFee', makerFee], ['takerFee', takerFee]] as const) {
    if (!Number.isFinite(fee) || fee < 0 || fee >= 1) {
      return { error: `${name} must be a fraction in [0, 1)` };
    }
  }

  return {
    pair: {
      symbol,
      baseCurrency,
      quoteCurrency,
      status,
      minPrice,
      maxPrice,
      tickSize,
      minQuantity,
      maxQuantity,
      minNotional,
      makerFee,
      takerFee,
    },
  };
}
