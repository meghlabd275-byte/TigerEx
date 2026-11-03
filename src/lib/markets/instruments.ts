/**
 * Validation for options, leveraged ETF and TradFi listings.
 *
 * Kept free of `next/server` so the rules can be exercised by the logic test
 * runner. An option listed with a past expiry or a non-positive strike would
 * never settle correctly, and a TradFi instrument without a reference symbol
 * has no price source, so every check here is fail-closed.
 */

export const SYMBOL_RE = /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/;

const SETTLEMENT_ASSETS = ['USDT', 'USDC', 'RUSD', 'RYUSD', 'BTC', 'ETH', 'TGR'];
const OPTION_TYPES = ['call', 'put'];
const EXERCISE_STYLES = ['european', 'american'];
const ETF_DIRECTIONS = ['long', 'short'];
const TRADFI_TYPES = ['stock', 'forex', 'commodity', 'index'];
const TRADFI_PRICE_SOURCES = ['oracle', 'tiger_index', 'reference_feed'];
const LISTING_STATUSES = ['active', 'paused', 'delisting', 'maintenance'];

export interface OptionsMarketInput {
  symbol: string;
  underlying: string;
  settlementAsset: string;
  optionType: string;
  strikePrice: number;
  expiryNs: number;
  exerciseStyle: string;
  contractSize: number;
  tickSize: number;
  minQuantity: number;
  maxQuantity: number;
  makerFeeBps: number;
  takerFeeBps: number;
  impliedVolatility: number | null;
  status: string;
}

export interface EtfMarketInput {
  symbol: string;
  underlying: string;
  settlementAsset: string;
  leverage: number;
  direction: string;
  nav: number;
  rebalanceThreshold: number;
  managementFeeApr: number;
  status: string;
}

export interface TradFiMarketInput {
  symbol: string;
  instrumentType: string;
  settlementAsset: string;
  priceSource: string;
  referenceSymbol: string;
  tickSize: number;
  minQuantity: number;
  maxQuantity: number;
  maxLeverage: number;
  makerFeeBps: number;
  takerFeeBps: number;
  tradingHours: string;
  status: string;
}

export type OptionsValidation = { market: OptionsMarketInput } | { error: string };
export type EtfValidation = { market: EtfMarketInput } | { error: string };
export type TradFiValidation = { market: TradFiMarketInput } | { error: string };

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function integerInRange(value: unknown, min: number, max: number): number | null {
  const n = finiteNumber(value);
  if (n === null || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function checkSymbol(body: Record<string, unknown>): { base: string; quote: string; symbol: string } | { error: string } {
  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return { error: 'symbol must be of the form BASE/QUOTE, for example BTC/RUSD' };
  }
  const [base, quote] = symbol.split('/');
  if (base === quote) return { error: 'base and quote assets must differ' };
  return { base, quote, symbol };
}

/**
 * Validate an options listing.
 *
 * A European option is cash-settled at expiry, so it must carry a future
 * expiry timestamp. The strike, tick size and contract size must all be
 * positive: a zero strike would make every premium meaningless.
 */
export function validateOptionsMarket(body: Record<string, unknown>, nowNs: number): OptionsValidation {
  const sym = checkSymbol(body);
  if ('error' in sym) return sym;

  const underlying = String(body.underlying ?? sym.base).trim().toUpperCase();
  if (underlying !== sym.base) {
    return { error: 'underlying must match the symbol base asset' };
  }

  const settlementAsset = String(body.settlementAsset ?? 'RUSD').trim().toUpperCase();
  if (!SETTLEMENT_ASSETS.includes(settlementAsset)) {
    return { error: `settlementAsset must be one of ${SETTLEMENT_ASSETS.join(', ')}` };
  }

  const optionType = String(body.optionType ?? '').trim().toLowerCase();
  if (!OPTION_TYPES.includes(optionType)) {
    return { error: `optionType must be one of ${OPTION_TYPES.join(', ')}` };
  }

  const exerciseStyle = String(body.exerciseStyle ?? 'european').trim().toLowerCase();
  if (!EXERCISE_STYLES.includes(exerciseStyle)) {
    return { error: `exerciseStyle must be one of ${EXERCISE_STYLES.join(', ')}` };
  }

  const strikePrice = positiveNumber(body.strikePrice);
  if (strikePrice === null) return { error: 'strikePrice must be a positive number' };

  const expiryNs = finiteNumber(body.expiryNs);
  if (expiryNs === null || !Number.isInteger(expiryNs) || expiryNs <= 0) {
    return { error: 'expiryNs must be a positive integer nanosecond timestamp' };
  }
  if (expiryNs <= nowNs) return { error: 'expiryNs must be in the future' };

  const contractSize = positiveNumber(body.contractSize ?? 1);
  if (contractSize === null) return { error: 'contractSize must be a positive number' };

  const tickSize = positiveNumber(body.tickSize);
  if (tickSize === null) return { error: 'tickSize must be a positive number' };

  const minQuantity = positiveNumber(body.minQuantity);
  const maxQuantity = positiveNumber(body.maxQuantity);
  if (minQuantity === null || maxQuantity === null) {
    return { error: 'minQuantity and maxQuantity must be positive' };
  }
  if (minQuantity >= maxQuantity) return { error: 'minQuantity must be less than maxQuantity' };

  const makerFeeBps = integerInRange(body.makerFeeBps ?? 2, 0, 9999);
  if (makerFeeBps === null) return { error: 'makerFeeBps must be an integer in [0, 9999]' };
  const takerFeeBps = integerInRange(body.takerFeeBps ?? 5, 0, 9999);
  if (takerFeeBps === null) return { error: 'takerFeeBps must be an integer in [0, 9999]' };

  let impliedVolatility: number | null = null;
  if (body.impliedVolatility !== undefined && body.impliedVolatility !== null && body.impliedVolatility !== '') {
    const iv = positiveNumber(body.impliedVolatility);
    if (iv === null || iv > 10) {
      return { error: 'impliedVolatility must be a positive fraction no greater than 10' };
    }
    impliedVolatility = iv;
  }

  const status = String(body.status ?? 'active').toLowerCase();
  if (!LISTING_STATUSES.includes(status)) {
    return { error: `status must be one of ${LISTING_STATUSES.join(', ')}` };
  }

  return {
    market: {
      symbol: sym.symbol,
      underlying,
      settlementAsset,
      optionType,
      strikePrice,
      expiryNs,
      exerciseStyle,
      contractSize,
      tickSize,
      minQuantity,
      maxQuantity,
      makerFeeBps,
      takerFeeBps,
      impliedVolatility,
      status,
    },
  };
}

/**
 * Validate a leveraged token (ETF) listing.
 *
 * The leverage must be a whole multiple and non-zero; the direction decides its
 * sign. NAV must be positive because a token is issued at NAV.
 */
export function validateEtfMarket(body: Record<string, unknown>): EtfValidation {
  const sym = checkSymbol(body);
  if ('error' in sym) return sym;

  const underlying = String(body.underlying ?? sym.base).trim().toUpperCase();
  // A leveraged token's symbol carries the multiple in its base (`BTC3L`), so
  // the underlying must be a prefix of the base rather than equal to it.
  if (!sym.base.startsWith(underlying)) {
    return { error: 'underlying must be a prefix of the symbol base asset' };
  }

  const settlementAsset = String(body.settlementAsset ?? 'RUSD').trim().toUpperCase();
  if (!SETTLEMENT_ASSETS.includes(settlementAsset)) {
    return { error: `settlementAsset must be one of ${SETTLEMENT_ASSETS.join(', ')}` };
  }

  const leverage = integerInRange(body.leverage, 1, 20);
  if (leverage === null) return { error: 'leverage must be an integer in [1, 20]' };

  const direction = String(body.direction ?? '').trim().toLowerCase();
  if (!ETF_DIRECTIONS.includes(direction)) {
    return { error: `direction must be one of ${ETF_DIRECTIONS.join(', ')}` };
  }

  const nav = positiveNumber(body.nav);
  if (nav === null) return { error: 'nav must be a positive number' };

  const rebalanceThreshold = finiteNumber(body.rebalanceThreshold ?? 0.05);
  if (rebalanceThreshold === null || rebalanceThreshold <= 0 || rebalanceThreshold >= 1) {
    return { error: 'rebalanceThreshold must be a fraction in (0, 1)' };
  }

  const managementFeeApr = finiteNumber(body.managementFeeApr ?? 0.02);
  if (managementFeeApr === null || managementFeeApr < 0 || managementFeeApr >= 1) {
    return { error: 'managementFeeApr must be a fraction in [0, 1)' };
  }

  const status = String(body.status ?? 'active').toLowerCase();
  if (!LISTING_STATUSES.includes(status)) {
    return { error: `status must be one of ${LISTING_STATUSES.join(', ')}` };
  }

  return {
    market: {
      symbol: sym.symbol,
      underlying,
      settlementAsset,
      leverage,
      direction,
      nav,
      rebalanceThreshold,
      managementFeeApr,
      status,
    },
  };
}

/**
 * Validate a TradFi instrument listing (stock, FX, commodity or index).
 *
 * The reference symbol is the identifier the price source publishes; without
 * it the instrument has no price and must not be listed.
 */
export function validateTradFiMarket(body: Record<string, unknown>): TradFiValidation {
  const sym = checkSymbol(body);
  if ('error' in sym) return sym;

  const instrumentType = String(body.instrumentType ?? '').trim().toLowerCase();
  if (!TRADFI_TYPES.includes(instrumentType)) {
    return { error: `instrumentType must be one of ${TRADFI_TYPES.join(', ')}` };
  }

  const settlementAsset = String(body.settlementAsset ?? 'RUSD').trim().toUpperCase();
  if (!SETTLEMENT_ASSETS.includes(settlementAsset)) {
    return { error: `settlementAsset must be one of ${SETTLEMENT_ASSETS.join(', ')}` };
  }

  const priceSource = String(body.priceSource ?? 'oracle').trim().toLowerCase();
  if (!TRADFI_PRICE_SOURCES.includes(priceSource)) {
    return { error: `priceSource must be one of ${TRADFI_PRICE_SOURCES.join(', ')}` };
  }

  const referenceSymbol = String(body.referenceSymbol ?? '').trim().toUpperCase();
  if (referenceSymbol.length === 0 || referenceSymbol.length > 40) {
    return { error: 'referenceSymbol is required and must be at most 40 characters' };
  }

  const tickSize = positiveNumber(body.tickSize);
  if (tickSize === null) return { error: 'tickSize must be a positive number' };

  const minQuantity = positiveNumber(body.minQuantity);
  const maxQuantity = positiveNumber(body.maxQuantity);
  if (minQuantity === null || maxQuantity === null) {
    return { error: 'minQuantity and maxQuantity must be positive' };
  }
  if (minQuantity >= maxQuantity) return { error: 'minQuantity must be less than maxQuantity' };

  const maxLeverage = integerInRange(body.maxLeverage ?? 1, 1, 100);
  if (maxLeverage === null) return { error: 'maxLeverage must be an integer in [1, 100]' };

  const makerFeeBps = integerInRange(body.makerFeeBps ?? 2, 0, 9999);
  if (makerFeeBps === null) return { error: 'makerFeeBps must be an integer in [0, 9999]' };
  const takerFeeBps = integerInRange(body.takerFeeBps ?? 5, 0, 9999);
  if (takerFeeBps === null) return { error: 'takerFeeBps must be an integer in [0, 9999]' };

  const tradingHours = String(body.tradingHours ?? '24/7').trim();
  if (tradingHours.length === 0 || tradingHours.length > 60) {
    return { error: 'tradingHours must be a non-empty string of at most 60 characters' };
  }

  const status = String(body.status ?? 'active').toLowerCase();
  if (!LISTING_STATUSES.includes(status)) {
    return { error: `status must be one of ${LISTING_STATUSES.join(', ')}` };
  }

  return {
    market: {
      symbol: sym.symbol,
      instrumentType,
      settlementAsset,
      priceSource,
      referenceSymbol,
      tickSize,
      minQuantity,
      maxQuantity,
      maxLeverage,
      makerFeeBps,
      takerFeeBps,
      tradingHours,
      status,
    },
  };
}

/** Validate a leverage bracket row for a futures market. */
export function validateRiskLimit(
  body: Record<string, unknown>,
): { limit: { symbol: string; tier: number; maxPositionNotional: number; maxLeverage: number; maintenanceMarginRate: number } } | { error: string } {
  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return { error: 'symbol must be of the form BASE/QUOTE' };
  }

  const tier = integerInRange(body.tier, 1, 50);
  if (tier === null) return { error: 'tier must be an integer in [1, 50]' };

  const maxPositionNotional = positiveNumber(body.maxPositionNotional);
  if (maxPositionNotional === null) return { error: 'maxPositionNotional must be a positive number' };

  const maxLeverage = integerInRange(body.maxLeverage, 1, 1001);
  if (maxLeverage === null) return { error: 'maxLeverage must be an integer in [1, 1001]' };

  const maintenanceMarginRate = positiveNumber(body.maintenanceMarginRate);
  if (maintenanceMarginRate === null || maintenanceMarginRate >= 1) {
    return { error: 'maintenanceMarginRate must be a fraction in (0, 1)' };
  }

  return { limit: { symbol, tier, maxPositionNotional, maxLeverage, maintenanceMarginRate } };
}
