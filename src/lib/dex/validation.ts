/**
 * Validation for TigerSwap administrative listings.
 *
 * Kept free of `next/server` so the rules can be exercised directly by the
 * logic test runner. The admin routes are thin wrappers: they authenticate,
 * call one of these validators, write the row and append the audit entry.
 *
 * The rules are strict because a pool or lending market persisted with an
 * impossible parameter would misprice every trade or let a borrow exceed its
 * collateral: a fee outside [0, 1), an inverted price range, a weight set that
 * does not sum to one, or an LTV above the liquidation threshold are all
 * refused rather than stored.
 */

export const SYMBOL_RE = /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/;
export const ASSET_RE = /^[A-Z0-9]{1,20}$/;

export type Validation<T> = { value: T } | { error: string };

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fraction(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : null;
}

function asset(value: unknown): string | null {
  const symbol = String(value ?? '').trim().toUpperCase();
  return ASSET_RE.test(symbol) ? symbol : null;
}

export const POOL_KINDS = ['v2', 'v3', 'stable', 'weighted'] as const;
export type PoolKind = (typeof POOL_KINDS)[number];

export interface PoolInput {
  kind: PoolKind;
  tokens: string[];
  fee: number;
  amplification: number | null;
  weights: number[] | null;
  tickSpacing: number | null;
  sqrtPrice: number | null;
  sqrtPriceLower: number | null;
  sqrtPriceUpper: number | null;
  reserves: Record<string, number>;
  status: string;
}

/**
 * Validate a pool creation request.
 *
 * Each pool shape has its own required parameters: a stable pool needs an
 * amplification coefficient, a weighted pool needs weights that sum to one, and
 * a concentrated pool needs a tick spacing and a price range with the current
 * price inside it. A V2 pool accepts exactly two tokens.
 */
export function validatePoolInput(body: Record<string, unknown>): Validation<PoolInput> {
  const kind = String(body.kind ?? '').trim().toLowerCase() as PoolKind;
  if (!POOL_KINDS.includes(kind)) {
    return { error: `kind must be one of ${POOL_KINDS.join(', ')}` };
  }

  const rawTokens = body.tokens;
  if (!Array.isArray(rawTokens) || rawTokens.length < 2) {
    return { error: 'tokens must be an array of at least two asset symbols' };
  }
  const tokens: string[] = [];
  for (const raw of rawTokens) {
    const symbol = asset(raw);
    if (!symbol) return { error: 'every token must be an asset symbol' };
    tokens.push(symbol);
  }
  if (new Set(tokens).size !== tokens.length) return { error: 'tokens must be distinct' };
  if (kind === 'v2' && tokens.length !== 2) return { error: 'a v2 pool has exactly two tokens' };
  if (kind === 'v3' && tokens.length !== 2) return { error: 'a concentrated pool has exactly two tokens' };

  const fee = fraction(body.fee);
  if (fee === null) return { error: 'fee must be a fraction in [0, 1)' };

  let amplification: number | null = null;
  if (kind === 'stable') {
    amplification = positive(body.amplification);
    if (amplification === null || amplification > 1_000_000) {
      return { error: 'a stable pool requires a positive amplification coefficient' };
    }
  }

  let weights: number[] | null = null;
  if (kind === 'weighted') {
    if (!Array.isArray(body.weights) || body.weights.length !== tokens.length) {
      return { error: 'a weighted pool requires one weight per token' };
    }
    weights = body.weights.map((w) => Number(w));
    if (weights.some((w) => !Number.isFinite(w) || w <= 0)) {
      return { error: 'weights must be positive numbers' };
    }
    const total = weights.reduce((acc, w) => acc + w, 0);
    if (Math.abs(total - 1) > 1e-9) {
      return { error: 'weights must sum to 1' };
    }
  }

  let tickSpacing: number | null = null;
  let sqrtPrice: number | null = null;
  let sqrtPriceLower: number | null = null;
  let sqrtPriceUpper: number | null = null;
  if (kind === 'v3') {
    const spacing = Number(body.tickSpacing);
    if (!Number.isInteger(spacing) || spacing < 1 || spacing > 100_000) {
      return { error: 'tickSpacing must be a positive integer no greater than 100000' };
    }
    tickSpacing = spacing;
    sqrtPrice = positive(body.sqrtPrice);
    sqrtPriceLower = positive(body.sqrtPriceLower);
    sqrtPriceUpper = positive(body.sqrtPriceUpper);
    if (sqrtPrice === null || sqrtPriceLower === null || sqrtPriceUpper === null) {
      return { error: 'a concentrated pool requires positive sqrtPrice, sqrtPriceLower and sqrtPriceUpper' };
    }
    if (sqrtPriceLower >= sqrtPriceUpper) {
      return { error: 'sqrtPriceLower must be below sqrtPriceUpper' };
    }
    if (sqrtPrice < sqrtPriceLower || sqrtPrice > sqrtPriceUpper) {
      return { error: 'sqrtPrice must lie inside the range' };
    }
  }

  const reserves: Record<string, number> = {};
  const rawReserves = body.reserves;
  if (rawReserves === undefined || rawReserves === null || typeof rawReserves !== 'object') {
    return { error: 'reserves must be an object keyed by token symbol' };
  }
  for (const token of tokens) {
    const value = positive((rawReserves as Record<string, unknown>)[token]);
    if (value === null) return { error: `reserves.${token} must be a positive number` };
    reserves[token] = value;
  }

  const status = String(body.status ?? 'active').trim().toLowerCase();
  if (!['active', 'paused', 'delisted'].includes(status)) {
    return { error: 'status must be one of active, paused, delisted' };
  }

  return {
    value: { kind, tokens, fee, amplification, weights, tickSpacing, sqrtPrice, sqrtPriceLower, sqrtPriceUpper, reserves, status },
  };
}

export const POOL_STATUSES = ['active', 'paused', 'delisted'] as const;

/**
 * Validate a partial pool update.
 *
 * Unlike pool creation, an update may touch a single field, so only the keys
 * present in the request are returned. That matters for a status change: the
 * update route must not be forced to resend the pool's tokens and reserves,
 * which a caller cannot know and which a bulk upsert would otherwise rewrite.
 * The same invariants as creation still apply (a fee is a fraction, a weighted
 * pool's weights sum to one, a concentrated range contains its price).
 */
export function validatePoolUpdate(body: Record<string, unknown>): Validation<Partial<PoolInput>> {
  const value: Partial<PoolInput> = {};

  if (body.fee !== undefined) {
    const fee = fraction(body.fee);
    if (fee === null) return { error: 'fee must be a fraction in [0, 1)' };
    value.fee = fee;
  }

  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!POOL_STATUSES.includes(status as (typeof POOL_STATUSES)[number])) {
      return { error: `status must be one of ${POOL_STATUSES.join(', ')}` };
    }
    value.status = status;
  }

  if (body.amplification !== undefined) {
    const amplification = positive(body.amplification);
    if (amplification === null || amplification > 1_000_000) {
      return { error: 'amplification must be a positive number no greater than 1000000' };
    }
    value.amplification = amplification;
  }

  if (body.weights !== undefined) {
    if (!Array.isArray(body.weights) || body.weights.length < 2) {
      return { error: 'weights must be an array with one entry per token' };
    }
    const weights = body.weights.map((w) => Number(w));
    if (weights.some((w) => !Number.isFinite(w) || w <= 0)) {
      return { error: 'weights must be positive numbers' };
    }
    if (Math.abs(weights.reduce((acc, w) => acc + w, 0) - 1) > 1e-9) {
      return { error: 'weights must sum to 1' };
    }
    value.weights = weights;
  }

  if (body.sqrtPrice !== undefined || body.sqrtPriceLower !== undefined || body.sqrtPriceUpper !== undefined) {
    const sqrtPrice = positive(body.sqrtPrice);
    const lower = positive(body.sqrtPriceLower);
    const upper = positive(body.sqrtPriceUpper);
    if (sqrtPrice === null || lower === null || upper === null) {
      return { error: 'a price update requires positive sqrtPrice, sqrtPriceLower and sqrtPriceUpper' };
    }
    if (lower >= upper) return { error: 'sqrtPriceLower must be below sqrtPriceUpper' };
    if (sqrtPrice < lower || sqrtPrice > upper) return { error: 'sqrtPrice must lie inside the range' };
    value.sqrtPrice = sqrtPrice;
    value.sqrtPriceLower = lower;
    value.sqrtPriceUpper = upper;
  }

  if (Object.keys(value).length === 0) return { error: 'no updatable field was provided' };
  return { value };
}

export interface LendingMarketInput {
  asset: string;
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  baseRate: number;
  kink: number;
  jumpMultiplier: number;
  supplyCap: number;
  borrowCap: number;
  status: string;
}

/**
 * Map a `dex_lending_markets` row onto the validator's camelCase input.
 *
 * The stored row is snake_case, so a partial update must be merged onto this
 * mapping rather than onto the row itself: spreading the row directly would
 * drop every field the caller did not send, and the validator would then read
 * `undefined` for the unchanged ones and refuse a legitimate update.
 */
export function lendingMarketRowToInput(row: Record<string, unknown>): LendingMarketInput {
  return {
    asset: String(row.asset ?? ''),
    ltv: Number(row.ltv),
    liquidationThreshold: Number(row.liquidation_threshold),
    liquidationBonus: Number(row.liquidation_bonus),
    baseRate: Number(row.base_rate),
    kink: Number(row.kink),
    jumpMultiplier: Number(row.jump_multiplier),
    supplyCap: Number(row.supply_cap),
    borrowCap: Number(row.borrow_cap),
    status: String(row.status ?? 'active'),
  };
}

/**
 * Validate a lending-market listing.
 *
 * The LTV must sit below the liquidation threshold, or a position could be
 * liquidated the moment it opened; the kink must be a fraction in (0, 1]; and
 * the caps must be positive so a market can never accept an unbounded supply.
 */
export function validateLendingMarketInput(body: Record<string, unknown>): Validation<LendingMarketInput> {
  const symbol = asset(body.asset);
  if (!symbol) return { error: 'asset must be an asset symbol' };

  const ltv = fraction(body.ltv);
  const liquidationThreshold = fraction(body.liquidationThreshold);
  if (ltv === null) return { error: 'ltv must be a fraction in [0, 1)' };
  if (liquidationThreshold === null) return { error: 'liquidationThreshold must be a fraction in [0, 1)' };
  if (ltv >= liquidationThreshold) {
    return { error: 'ltv must be below liquidationThreshold' };
  }

  const liquidationBonus = Number(body.liquidationBonus ?? 0.05);
  if (!Number.isFinite(liquidationBonus) || liquidationBonus < 0 || liquidationBonus >= 1) {
    return { error: 'liquidationBonus must be a fraction in [0, 1)' };
  }

  const baseRate = Number(body.baseRate ?? 0.05);
  if (!Number.isFinite(baseRate) || baseRate < 0 || baseRate >= 1) {
    return { error: 'baseRate must be a fraction in [0, 1)' };
  }

  const kink = Number(body.kink ?? 0.8);
  if (!Number.isFinite(kink) || kink <= 0 || kink > 1) {
    return { error: 'kink must be a fraction in (0, 1]' };
  }

  const jumpMultiplier = Number(body.jumpMultiplier ?? 1);
  if (!Number.isFinite(jumpMultiplier) || jumpMultiplier < 1) {
    return { error: 'jumpMultiplier must be at least 1' };
  }

  const supplyCap = positive(body.supplyCap);
  const borrowCap = positive(body.borrowCap);
  if (supplyCap === null) return { error: 'supplyCap must be a positive number' };
  if (borrowCap === null) return { error: 'borrowCap must be a positive number' };
  if (borrowCap > supplyCap) return { error: 'borrowCap must not exceed supplyCap' };

  const status = String(body.status ?? 'active').trim().toLowerCase();
  if (!['active', 'paused'].includes(status)) return { error: 'status must be active or paused' };

  return {
    value: { asset: symbol, ltv, liquidationThreshold, liquidationBonus, baseRate, kink, jumpMultiplier, supplyCap, borrowCap, status },
  };
}

export interface DexTokenInput {
  symbol: string;
  name: string;
  decimals: number;
  chain: string;
  contractAddress: string | null;
  logoUrl: string | null;
  coingeckoId: string | null;
  priceFeed: string | null;
  tags: string[];
  verified: boolean;
  spam: boolean;
  status: string;
}

/** Validate a token listing. A contract address is optional for native assets. */
export function validateDexTokenInput(body: Record<string, unknown>): Validation<DexTokenInput> {
  const symbol = asset(body.symbol);
  if (!symbol) return { error: 'symbol must be an asset symbol' };

  const name = String(body.name ?? '').trim();
  if (name.length < 1 || name.length > 100) return { error: 'name must be between 1 and 100 characters' };

  const decimals = Number(body.decimals ?? 18);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return { error: 'decimals must be an integer in [0, 36]' };
  }

  const chain = String(body.chain ?? 'tigerex').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(chain)) return { error: 'chain must be a short lowercase identifier' };

  const contractAddress = body.contractAddress === undefined || body.contractAddress === null
    ? null
    : String(body.contractAddress).trim();
  if (contractAddress !== null && !/^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(contractAddress)) {
    return { error: 'contractAddress must be an EVM or base58 address' };
  }

  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [];
  if (tags.some((t) => !/^[a-z0-9-]{1,32}$/.test(t))) {
    return { error: 'tags must be short lowercase identifiers' };
  }

  const status = String(body.status ?? 'active').trim().toLowerCase();
  if (!['active', 'paused', 'delisted'].includes(status)) {
    return { error: 'status must be one of active, paused, delisted' };
  }

  return {
    value: {
      symbol,
      name,
      decimals,
      chain,
      contractAddress,
      logoUrl: body.logoUrl ? String(body.logoUrl) : null,
      coingeckoId: body.coingeckoId ? String(body.coingeckoId) : null,
      priceFeed: body.priceFeed ? String(body.priceFeed) : null,
      tags,
      verified: Boolean(body.verified),
      spam: Boolean(body.spam),
      status,
    },
  };
}

export interface FarmInput {
  name: string;
  poolId: string;
  rewardToken: string;
  rewardRate: number;
  boostMultiplier: number;
  startAt: string | null;
  endAt: string | null;
  status: string;
}

/** Validate a farm creation request. */
export function validateFarmInput(body: Record<string, unknown>): Validation<FarmInput> {
  const name = String(body.name ?? '').trim();
  if (name.length < 1 || name.length > 100) return { error: 'name must be between 1 and 100 characters' };

  const poolId = String(body.poolId ?? '').trim();
  if (!poolId) return { error: 'poolId is required' };

  const rewardToken = asset(body.rewardToken);
  if (!rewardToken) return { error: 'rewardToken must be an asset symbol' };

  const rewardRate = positive(body.rewardRate);
  if (rewardRate === null) return { error: 'rewardRate must be a positive number' };

  const boostMultiplier = Number(body.boostMultiplier ?? 1);
  if (!Number.isFinite(boostMultiplier) || boostMultiplier < 1 || boostMultiplier > 10) {
    return { error: 'boostMultiplier must be between 1 and 10' };
  }

  const startAt = body.startAt ? new Date(String(body.startAt)) : null;
  const endAt = body.endAt ? new Date(String(body.endAt)) : null;
  if (startAt && Number.isNaN(startAt.getTime())) return { error: 'startAt must be a valid date' };
  if (endAt && Number.isNaN(endAt.getTime())) return { error: 'endAt must be a valid date' };
  if (startAt && endAt && startAt.getTime() >= endAt.getTime()) {
    return { error: 'endAt must be after startAt' };
  }

  const status = String(body.status ?? 'active').trim().toLowerCase();
  if (!['active', 'paused', 'ended'].includes(status)) {
    return { error: 'status must be one of active, paused, ended' };
  }

  return {
    value: {
      name,
      poolId,
      rewardToken,
      rewardRate,
      boostMultiplier,
      startAt: startAt ? startAt.toISOString() : null,
      endAt: endAt ? endAt.toISOString() : null,
      status,
    },
  };
}
