/**
 * Validation for futures, perpetual and margin market listings.
 *
 * Free of `next/server` so the rules can be exercised by the logic test
 * runner. A listing that reaches the database with a bad risk parameter would
 * let the engine open positions it can never margin, so every check here is
 * fail-closed.
 */

export const SYMBOL_RE = /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/;

const SETTLEMENT_ASSETS = ['USDT', 'USDC', 'RUSD', 'RYUSD', 'BTC', 'ETH', 'TGR'];
const CONTRACT_TYPES = ['USDT_M', 'USDC_M', 'RUSD_M', 'RYUSD_M', 'COIN_M', 'TGR_M'];
const LISTING_TYPES = ['perpetual', 'quarterly', 'bi_quarterly', 'delivery'];
const MARGIN_MODES = ['cross', 'isolated'];
const RISK_TIERS = ['low', 'medium', 'high'];

/** Highest leverage the engine will accept, matching the C++ engine ceiling. */
export const MAX_LEVERAGE = 1001;

export interface FuturesMarketInput {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settlementAsset: string;
  contractType: string;
  listingType: string;
  contractSize: number;
  tickSize: number;
  pricePrecision: number;
  quantityPrecision: number;
  minQuantity: number;
  maxQuantity: number;
  maxLeverage: number;
  makerFeeBps: number;
  takerFeeBps: number;
  fundingIntervalHours: number;
  fundingRateCap: number;
  maintenanceMarginRate: number;
  initialMarginRate: number;
  liquidationFeeRate: number;
  insuranceFundShare: number;
  deliveryTimeNs: number | null;
  status: string;
}

export interface MarginMarketInput {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  mode: string;
  maxLeverage: number;
  collateralLtv: Record<string, number>;
  liquidationThresholds: Record<string, number>;
  borrowableAssets: string[];
  interestBaseApr: number;
  interestKinkUtilization: number;
  interestKinkApr: number;
  interestMaxApr: number;
  liquidationBonus: number;
  riskTier: string;
  status: string;
}

export type FuturesValidation = { market: FuturesMarketInput } | { error: string };
export type MarginValidation = { market: MarginMarketInput } | { error: string };

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
    return { error: 'symbol must be of the form BASE/QUOTE, for example BTC/USDT' };
  }
  const [base, quote] = symbol.split('/');
  if (base === quote) return { error: 'base and quote assets must differ' };

  const baseAsset = String(body.baseAsset ?? base).trim().toUpperCase();
  const quoteAsset = String(body.quoteAsset ?? quote).trim().toUpperCase();
  if (baseAsset !== base || quoteAsset !== quote) {
    return { error: 'baseAsset/quoteAsset must match the symbol legs' };
  }
  return { base, quote, symbol };
}

/**
 * Validate a futures or perpetual listing.
 *
 * `deliveryTimeNs` is required for dated contracts and forbidden for
 * perpetuals: a perpetual with a delivery time would settle unexpectedly, and
 * a dated contract without one would never expire.
 */
export function validateFuturesMarket(body: Record<string, unknown>): FuturesValidation {
  const sym = checkSymbol(body);
  if ('error' in sym) return sym;

  const settlementAsset = String(body.settlementAsset ?? 'USDT').trim().toUpperCase();
  if (!SETTLEMENT_ASSETS.includes(settlementAsset)) {
    return { error: `settlementAsset must be one of ${SETTLEMENT_ASSETS.join(', ')}` };
  }

  const contractType = String(body.contractType ?? 'USDT_M').trim().toUpperCase();
  if (!CONTRACT_TYPES.includes(contractType)) {
    return { error: `contractType must be one of ${CONTRACT_TYPES.join(', ')}` };
  }

  const listingType = String(body.listingType ?? 'perpetual').trim().toLowerCase();
  if (!LISTING_TYPES.includes(listingType)) {
    return { error: `listingType must be one of ${LISTING_TYPES.join(', ')}` };
  }

  const contractSize = positiveNumber(body.contractSize ?? 1);
  if (contractSize === null) return { error: 'contractSize must be a positive number' };

  const tickSize = positiveNumber(body.tickSize);
  if (tickSize === null) return { error: 'tickSize must be a positive number' };

  const pricePrecision = integerInRange(body.pricePrecision ?? 2, 0, 8);
  if (pricePrecision === null) return { error: 'pricePrecision must be an integer in [0, 8]' };

  const quantityPrecision = integerInRange(body.quantityPrecision ?? 3, 0, 8);
  if (quantityPrecision === null) return { error: 'quantityPrecision must be an integer in [0, 8]' };

  const minQuantity = positiveNumber(body.minQuantity);
  const maxQuantity = positiveNumber(body.maxQuantity);
  if (minQuantity === null || maxQuantity === null) {
    return { error: 'minQuantity and maxQuantity must be positive' };
  }
  if (minQuantity >= maxQuantity) return { error: 'minQuantity must be less than maxQuantity' };

  const maxLeverage = integerInRange(body.maxLeverage ?? 125, 1, MAX_LEVERAGE);
  if (maxLeverage === null) {
    return { error: `maxLeverage must be an integer in [1, ${MAX_LEVERAGE}]` };
  }

  const makerFeeBps = integerInRange(body.makerFeeBps ?? 2, 0, 9999);
  if (makerFeeBps === null) return { error: 'makerFeeBps must be an integer in [0, 9999]' };
  const takerFeeBps = integerInRange(body.takerFeeBps ?? 5, 0, 9999);
  if (takerFeeBps === null) return { error: 'takerFeeBps must be an integer in [0, 9999]' };

  const fundingIntervalHours = integerInRange(body.fundingIntervalHours ?? 8, 1, 24);
  if (fundingIntervalHours === null) {
    return { error: 'fundingIntervalHours must be an integer in [1, 24]' };
  }

  const fundingRateCap = positiveNumber(body.fundingRateCap ?? 0.01);
  if (fundingRateCap === null || fundingRateCap > 0.1) {
    return { error: 'fundingRateCap must be a positive fraction no greater than 0.1' };
  }

  const maintenanceMarginRate = positiveNumber(body.maintenanceMarginRate ?? 0.005);
  if (maintenanceMarginRate === null || maintenanceMarginRate >= 1) {
    return { error: 'maintenanceMarginRate must be a fraction in (0, 1)' };
  }

  const initialMarginRate = positiveNumber(body.initialMarginRate ?? 0.008);
  if (initialMarginRate === null || initialMarginRate >= 1) {
    return { error: 'initialMarginRate must be a fraction in (0, 1)' };
  }
  // Initial margin below maintenance margin would let a position be liquidated
  // the instant it opened.
  if (initialMarginRate < maintenanceMarginRate) {
    return { error: 'initialMarginRate must be at least maintenanceMarginRate' };
  }

  const liquidationFeeRate = finiteNumber(body.liquidationFeeRate ?? 0.005);
  if (liquidationFeeRate === null || liquidationFeeRate < 0 || liquidationFeeRate >= 1) {
    return { error: 'liquidationFeeRate must be a fraction in [0, 1)' };
  }

  const insuranceFundShare = finiteNumber(body.insuranceFundShare ?? 0.1);
  if (insuranceFundShare === null || insuranceFundShare < 0 || insuranceFundShare > 1) {
    return { error: 'insuranceFundShare must be a fraction in [0, 1]' };
  }

  const status = String(body.status ?? 'active').toLowerCase();
  if (!['active', 'paused', 'delisting', 'maintenance'].includes(status)) {
    return { error: 'status must be one of active, paused, delisting, maintenance' };
  }

  const rawDelivery = body.deliveryTimeNs;
  let deliveryTimeNs: number | null = null;
  if (rawDelivery !== undefined && rawDelivery !== null && rawDelivery !== '') {
    const parsed = finiteNumber(rawDelivery);
    if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
      return { error: 'deliveryTimeNs must be a positive integer nanosecond timestamp' };
    }
    deliveryTimeNs = parsed;
  }

  if (listingType === 'perpetual' && deliveryTimeNs !== null) {
    return { error: 'a perpetual listing must not carry a deliveryTimeNs' };
  }
  if (listingType !== 'perpetual' && deliveryTimeNs === null) {
    return { error: 'a dated listing requires deliveryTimeNs' };
  }
  if (deliveryTimeNs !== null && deliveryTimeNs <= Date.now() * 1e6) {
    return { error: 'deliveryTimeNs must be in the future' };
  }

  return {
    market: {
      symbol: sym.symbol,
      baseAsset: sym.base,
      quoteAsset: sym.quote,
      settlementAsset,
      contractType,
      listingType,
      contractSize,
      tickSize,
      pricePrecision,
      quantityPrecision,
      minQuantity,
      maxQuantity,
      maxLeverage,
      makerFeeBps,
      takerFeeBps,
      fundingIntervalHours,
      fundingRateCap,
      maintenanceMarginRate,
      initialMarginRate,
      liquidationFeeRate,
      insuranceFundShare,
      deliveryTimeNs,
      status,
    },
  };
}

/**
 * Validate a spot margin listing.
 *
 * Liquidation thresholds are per collateral asset, as on every major venue:
 * a stablecoin tolerates more debt against it than a volatile altcoin does.
 * Each asset's LTV must be strictly below its own threshold, otherwise the
 * collateral would be liquidatable the moment it was posted.
 */
export function validateMarginMarket(body: Record<string, unknown>): MarginValidation {
  const sym = checkSymbol(body);
  if ('error' in sym) return sym;

  const mode = String(body.mode ?? 'cross').trim().toLowerCase();
  if (!MARGIN_MODES.includes(mode)) {
    return { error: `mode must be one of ${MARGIN_MODES.join(', ')}` };
  }

  const maxLeverage = integerInRange(body.maxLeverage ?? 10, 1, 10);
  if (maxLeverage === null) return { error: 'maxLeverage must be an integer in [1, 10]' };

  const rawLtv = body.collateralLtv;
  if (!rawLtv || typeof rawLtv !== 'object' || Array.isArray(rawLtv)) {
    return { error: 'collateralLtv must be an object mapping asset to LTV' };
  }
  const collateralLtv: Record<string, number> = {};
  for (const [asset, value] of Object.entries(rawLtv as Record<string, unknown>)) {
    const ltv = positiveNumber(value);
    if (ltv === null || ltv >= 1) {
      return { error: `collateralLtv.${asset} must be a fraction in (0, 1)` };
    }
    collateralLtv[asset.trim().toUpperCase()] = ltv;
  }
  if (Object.keys(collateralLtv).length === 0) {
    return { error: 'collateralLtv must list at least one asset' };
  }

  const rawThresholds = body.liquidationThresholds;
  if (!rawThresholds || typeof rawThresholds !== 'object' || Array.isArray(rawThresholds)) {
    return { error: 'liquidationThresholds must be an object mapping asset to threshold' };
  }
  const liquidationThresholds: Record<string, number> = {};
  for (const [asset, value] of Object.entries(rawThresholds as Record<string, unknown>)) {
    const threshold = positiveNumber(value);
    if (threshold === null || threshold >= 1) {
      return { error: `liquidationThresholds.${asset} must be a fraction in (0, 1)` };
    }
    liquidationThresholds[asset.trim().toUpperCase()] = threshold;
  }
  // Every collateral asset must have a threshold, and vice versa: a collateral
  // asset with no threshold could never be liquidated.
  for (const asset of Object.keys(collateralLtv)) {
    if (liquidationThresholds[asset] === undefined) {
      return { error: `liquidationThresholds must cover collateral asset ${asset}` };
    }
  }

  const rawBorrowable = body.borrowableAssets;
  if (!Array.isArray(rawBorrowable) || rawBorrowable.length === 0) {
    return { error: 'borrowableAssets must be a non-empty array' };
  }
  const borrowableAssets = rawBorrowable
    .map((asset) => String(asset).trim().toUpperCase())
    .filter((asset) => asset.length > 0);
  if (borrowableAssets.length !== rawBorrowable.length) {
    return { error: 'borrowableAssets must not contain empty entries' };
  }

  const interestBaseApr = finiteNumber(body.interestBaseApr ?? 0.05);
  if (interestBaseApr === null || interestBaseApr < 0) {
    return { error: 'interestBaseApr must be a non-negative fraction' };
  }

  const interestKinkUtilization = positiveNumber(body.interestKinkUtilization ?? 0.8);
  if (interestKinkUtilization === null || interestKinkUtilization >= 1) {
    return { error: 'interestKinkUtilization must be a fraction in (0, 1)' };
  }

  const interestKinkApr = finiteNumber(body.interestKinkApr ?? 0.5);
  if (interestKinkApr === null || interestKinkApr < interestBaseApr) {
    return { error: 'interestKinkApr must be at least interestBaseApr' };
  }

  const interestMaxApr = finiteNumber(body.interestMaxApr ?? 1.0);
  if (interestMaxApr === null || interestMaxApr < interestKinkApr) {
    return { error: 'interestMaxApr must be at least interestKinkApr' };
  }

  for (const [asset, ltv] of Object.entries(collateralLtv)) {
    const threshold = liquidationThresholds[asset];
    if (ltv >= threshold) {
      return {
        error: `collateralLtv.${asset} (${ltv}) must be below its liquidationThreshold (${threshold})`,
      };
    }
  }

  const liquidationBonus = finiteNumber(body.liquidationBonus ?? 0.05);
  if (liquidationBonus === null || liquidationBonus < 0 || liquidationBonus > 0.5) {
    return { error: 'liquidationBonus must be a fraction in [0, 0.5]' };
  }

  const riskTier = String(body.riskTier ?? 'medium').trim().toLowerCase();
  if (!RISK_TIERS.includes(riskTier)) {
    return { error: `riskTier must be one of ${RISK_TIERS.join(', ')}` };
  }

  const status = String(body.status ?? 'active').toLowerCase();
  if (!['active', 'paused'].includes(status)) {
    return { error: 'status must be one of active, paused' };
  }

  return {
    market: {
      symbol: sym.symbol,
      baseAsset: sym.base,
      quoteAsset: sym.quote,
      mode,
      maxLeverage,
      collateralLtv,
      liquidationThresholds,
      borrowableAssets,
      interestBaseApr,
      interestKinkUtilization,
      interestKinkApr,
      interestMaxApr,
      liquidationBonus,
      riskTier,
      status,
    },
  };
}
