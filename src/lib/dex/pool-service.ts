/**
 * TigerSwap pool persistence and execution helpers.
 *
 * Translates a `dex_pools` row into the pure pool definition the router and the
 * AMM math consume, and writes reserves back after a trade. All reads and
 * writes go through the SQLite layer with parameterized statements, and a
 * failure to load or price a pool surfaces as a typed error rather than a zero
 * reserve that would misprice every following trade.
 */

import { getDb, generateId } from '@/lib/db';
import { AmmError, type StablePool, type V3PoolState, type WeightedPool } from '@/lib/dex/amm';
import type { PoolDefinition } from '@/lib/dex/router';
import { valueInQuote } from '@/lib/trading/valuation';

export class DexError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface DexPoolRow {
  pool_id: string;
  kind: string;
  address: string;
  tokens: string;
  fee: number;
  amplification: number | null;
  weights: string | null;
  tick_spacing: number | null;
  sqrt_price: number | null;
  liquidity: number | null;
  sqrt_price_lower: number | null;
  sqrt_price_upper: number | null;
  reserves: string;
  total_supply: number;
  tvl_usd: number;
  volume_24h_usd: number;
  fee_24h_usd: number;
  status: string;
}

/** Refuse a DEX request while the relevant scope is paused. */
export function assertDexOpen(...scopes: string[]): void {
  const all = ['exchange', 'dex', ...scopes];
  const placeholders = all.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT scope, paused, reason FROM exchange_controls WHERE scope IN (${placeholders})`)
    .all(...all) as Array<{ scope: string; paused: number; reason: string | null }>;
  const paused = rows.find((row) => row.paused === 1);
  if (paused) {
    throw new DexError(
      'DEX_PAUSED',
      `${paused.scope} is paused${paused.reason ? `: ${paused.reason}` : ''}`,
      409,
    );
  }
}

/**
 * Refuse an operation when the token, pool or wallet is blacklisted.
 *
 * A blacklist entry is checked on every settlement path, so adding one blocks
 * the operation immediately even while a pool still holds the asset.
 */
export function assertNotBlacklisted(entries: Array<{ kind: 'token' | 'wallet' | 'pool'; value: string }>): void {
  const db = getDb();
  const statement = db.prepare('SELECT reason FROM dex_blacklist WHERE kind = ? AND value = ?');
  for (const entry of entries) {
    const row = statement.get(entry.kind, entry.value) as { reason: string | null } | undefined;
    if (row) {
      throw new DexError(
        'BLACKLISTED',
        `${entry.kind} ${entry.value} is blocked${row.reason ? `: ${row.reason}` : ''}`,
        403,
      );
    }
  }
}

/**
 * The symbol of the LP token minted for a pool.
 *
 * Each pool kind has its own prefix so a position's LP token cannot be confused
 * with another kind's; the farm and liquidity paths both derive it from here so
 * they can never disagree about which token backs a stake.
 */
export function lpTokenSymbol(row: { kind: string; tokens: string }): string {
  const tokens = parseStringArray(row.tokens, 'tokens');
  const prefix =
    row.kind === 'v2' ? 'TS-LP' : row.kind === 'stable' ? 'TS-SLP' : row.kind === 'weighted' ? 'TS-WLP' : 'TS-CLP';
  return `${prefix}-${tokens.join('-')}`;
}

/** Parse a JSON object column, refusing a row whose payload is not an object. */
export function parseObject(raw: string, label: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error(`bad reserve for ${key}`);
      out[key] = n;
    }
    return out;
  } catch (error) {
    throw new DexError('CORRUPT_POOL', `${label} is not a valid reserve map: ${(error as Error).message}`, 500);
  }
}

/** Parse a JSON array column of strings. */
export function parseStringArray(raw: string, label: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string')) throw new Error('not a string array');
    return parsed as string[];
  } catch (error) {
    throw new DexError('CORRUPT_POOL', `${label} is not a valid token list: ${(error as Error).message}`, 500);
  }
}

/**
 * Parse a JSON array column of finite, non-negative numbers.
 *
 * Weights are written as JSON numbers, so a string-array parser would reject
 * every weighted pool and take the whole router down with it.
 */
export function parseNumberArray(raw: string, label: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not an array');
    const out = parsed.map((value) => {
      if (typeof value !== 'number') throw new Error('not a number');
      if (!Number.isFinite(value) || value < 0) throw new Error('not finite and non-negative');
      return value;
    });
    return out;
  } catch (error) {
    throw new DexError('CORRUPT_POOL', `${label} is not a valid number list: ${(error as Error).message}`, 500);
  }
}

/** Load an active pool by id, or throw. */
export function loadPool(poolId: string): DexPoolRow {
  const row = getDb().prepare('SELECT * FROM dex_pools WHERE pool_id = ?').get(poolId) as
    | DexPoolRow
    | undefined;
  if (!row) throw new DexError('UNKNOWN_POOL', `pool ${poolId} does not exist`, 404);
  if (row.status !== 'active') throw new DexError('POOL_INACTIVE', `pool ${poolId} is ${row.status}`, 409);
  return row;
}

/**
 * Every active pool that is not blacklisted, as router definitions.
 *
 * A blacklisted pool is dropped here rather than at the hop, so a route can
 * never be priced or settled through it and the aggregator simply picks the
 * next-best path.
 */
export function loadActivePools(): Array<{ row: DexPoolRow; definition: PoolDefinition }> {
  const rows = getDb().prepare("SELECT * FROM dex_pools WHERE status = 'active'").all() as DexPoolRow[];
  const blocked = new Set(
    (getDb().prepare("SELECT value FROM dex_blacklist WHERE kind = 'pool'").all() as Array<{ value: string }>).map(
      (row) => row.value,
    ),
  );
  return rows
    .filter((row) => !blocked.has(row.pool_id))
    .map((row) => ({ row, definition: poolDefinition(row) }));
}

/** Convert a pool row into the pure definition the AMM math consumes. */
export function poolDefinition(row: DexPoolRow): PoolDefinition {
  const tokens = parseStringArray(row.tokens, 'tokens');
  const reserves = parseObject(row.reserves, 'reserves');

  if (row.kind === 'v2') {
    for (const token of tokens) {
      if (!Number.isFinite(reserves[token]) || reserves[token] <= 0) {
        throw new DexError('EMPTY_POOL', `pool ${row.pool_id} has no reserve for ${token}`, 409);
      }
    }
    return { kind: 'v2', reserves, fee: row.fee };
  }

  if (row.kind === 'stable') {
    if (!row.amplification || row.amplification <= 0) {
      throw new DexError('CORRUPT_POOL', `stable pool ${row.pool_id} has no amplification`, 500);
    }
    const pool: StablePool = { amplification: row.amplification, balances: tokens.map((t) => reserves[t] ?? 0) };
    return { kind: 'stable', coins: tokens, pool, fee: row.fee };
  }

  if (row.kind === 'weighted') {
    const weights = parseNumberArray(row.weights ?? '', 'weights');
    if (weights.length !== tokens.length || weights.some((w) => !Number.isFinite(w) || w <= 0)) {
      throw new DexError('CORRUPT_POOL', `weighted pool ${row.pool_id} has invalid weights`, 500);
    }
    const pool: WeightedPool = { balances: tokens.map((t) => reserves[t] ?? 0), weights, fee: row.fee };
    return { kind: 'weighted', tokens, pool };
  }

  if (row.kind === 'v3') {
    if (tokens.length !== 2) throw new DexError('CORRUPT_POOL', 'a concentrated pool has exactly two tokens', 500);
    const state: V3PoolState = {
      sqrtPrice: Number(row.sqrt_price),
      liquidity: Number(row.liquidity),
      sqrtPriceLower: Number(row.sqrt_price_lower),
      sqrtPriceUpper: Number(row.sqrt_price_upper),
      fee: row.fee,
    };
    return { kind: 'v3', token0: tokens[0], token1: tokens[1], state };
  }

  throw new DexError('CORRUPT_POOL', `unknown pool kind ${row.kind}`, 500);
}

/**
 * Apply the deltas of one or more hops to the pools and persist the new state.
 *
 * Deltas are additive per pool, so a route that touches several pools, or a
 * split across disjoint pools, writes each pool exactly once. The reserve of
 * the input token grows and the output token shrinks; the invariant is checked
 * before the write so a rounding error cannot persist a pool that lost value.
 */
export function applyPoolDeltas(
  deltas: Map<string, { tokenIn: string; tokenOut: string; amountIn: number; amountOut: number }[]>,
): Map<string, Record<string, number>> {
  const db = getDb();
  const updated = new Map<string, Record<string, number>>();
  for (const [poolId, hops] of deltas) {
    const row = loadPool(poolId);
    const tokens = parseStringArray(row.tokens, 'tokens');
    const before = parseObject(row.reserves, 'reserves');
    const reserves = { ...before };

    for (const hop of hops) {
      if (!tokens.includes(hop.tokenIn) || !tokens.includes(hop.tokenOut)) {
        throw new DexError('UNSUPPORTED_PAIR', `pool ${poolId} does not hold ${hop.tokenIn}/${hop.tokenOut}`, 500);
      }
      if (!Number.isFinite(hop.amountIn) || hop.amountIn <= 0 || !Number.isFinite(hop.amountOut) || hop.amountOut <= 0) {
        throw new DexError('INVALID_DELTA', 'a swap delta must be a positive finite amount', 500);
      }
      reserves[hop.tokenIn] += hop.amountIn;
      reserves[hop.tokenOut] -= hop.amountOut;
      if (reserves[hop.tokenOut] <= 0) {
        throw new DexError('POOL_DRAINED', `pool ${poolId} would be left with no ${hop.tokenOut}`, 409);
      }
    }

    if (row.kind === 'v2' && tokens.length === 2) {
      const [a, b] = tokens;
      const kBefore = before[a] * before[b];
      const kAfter = reserves[a] * reserves[b];
      if (kAfter + 1e-9 < kBefore) {
        throw new DexError('INVARIANT_BROKEN', `pool ${poolId} would lose value`, 500);
      }
    }

    db.prepare(
      `UPDATE dex_pools SET reserves = ?, updated_at = datetime('now') WHERE pool_id = ?`,
    ).run(JSON.stringify(reserves), poolId);
    updated.set(poolId, reserves);
  }
  return updated;
}

/** Persist the new square-root price and active liquidity of a concentrated pool. */
export function updateV3State(poolId: string, sqrtPrice: number, liquidity: number): void {
  if (!Number.isFinite(sqrtPrice) || sqrtPrice <= 0 || !Number.isFinite(liquidity) || liquidity < 0) {
    throw new DexError('INVALID_STATE', 'concentrated pool state must be positive', 500);
  }
  getDb()
    .prepare("UPDATE dex_pools SET sqrt_price = ?, liquidity = ?, updated_at = datetime('now') WHERE pool_id = ?")
    .run(sqrtPrice, liquidity, poolId);
}

/** Value the pool's reserves in RUSD, or null when a leg is unpriced. */
export function poolTvlUsd(row: DexPoolRow): number | null {
  const tokens = parseStringArray(row.tokens, 'tokens');
  const reserves = parseObject(row.reserves, 'reserves');
  let total = 0;
  for (const token of tokens) {
    const value = valueInQuote(token, reserves[token] ?? 0, 'RUSD');
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** Recompute the 24-hour volume, fees and TVL columns for one pool. */
export function refreshPoolStats(poolId: string): void {
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT COALESCE(SUM(amount_in), 0) AS volume, COALESCE(SUM(fee), 0) AS fees
         FROM dex_swaps
        WHERE pool_id = ? AND created_at >= datetime('now', '-1 day')`,
    )
    .get(poolId) as { volume: number; fees: number };

  let tvl: number | null = null;
  try {
    const row = db.prepare('SELECT * FROM dex_pools WHERE pool_id = ?').get(poolId) as DexPoolRow | undefined;
    if (row) tvl = poolTvlUsd(row);
  } catch {
    tvl = null;
  }

  db.prepare(
    `UPDATE dex_pools
        SET volume_24h_usd = ?, fee_24h_usd = ?, tvl_usd = COALESCE(?, tvl_usd), updated_at = datetime('now')
      WHERE pool_id = ?`,
  ).run(stats.volume, stats.fees, tvl, poolId);
}

/**
 * Record a fee in the revenue ledger and route its parts.
 *
 * The treasury and insurance parts are credited to the protocol's own treasury
 * accounts; the LP part stays in the pool reserves and the veTGR and burn parts
 * are recorded for the weekly distribution and buyback bot. Every movement is a
 * real row, so the split can be audited.
 */
export function recordDexRevenue(
  source: string,
  asset: string,
  amount: number,
  split: { lp: number; vetgr: number; treasury: number; insurance: number; burn: number },
  referenceId: string,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO dex_revenue_ledger
       (entry_id, source, asset, amount, lp_share, vetgr_share, treasury_share, insurance_share, burn_share, reference_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    source,
    asset,
    amount,
    split.lp,
    split.vetgr,
    split.treasury,
    split.insurance,
    split.burn,
    referenceId,
  );

  if (split.treasury > 0) creditTreasury(asset, split.treasury, 'dex_treasury');
  if (split.insurance > 0) {
    creditTreasury(asset, split.insurance, 'dex_insurance');
    db.prepare(
      `INSERT INTO insurance_funds (contract, balance, target_balance, fee_share)
       VALUES ('dex', ?, 1000000, 0.1)
       ON CONFLICT(contract) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')`,
    ).run(split.insurance, split.insurance);
  }
}

/** Credit the protocol's treasury account for an asset, creating it on first use. */
export function creditTreasury(asset: string, amount: number, accountType: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  getDb()
    .prepare(
      `INSERT INTO treasury_accounts (account_id, asset, network, account_type, balance)
       VALUES (?, ?, 'TIGEREX', ?, ?)
       ON CONFLICT(asset, network, account_type) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')`,
    )
    .run(generateId(), asset, accountType, amount, amount);
}

/**
 * The balance of a protocol reward account.
 *
 * A reward pool may only pay out what it holds, so the balance is the gate every
 * settlement consults rather than an advisory figure.
 */
export function fundBalance(accountType: string, asset: string): number {
  const row = getDb()
    .prepare("SELECT balance FROM treasury_accounts WHERE asset = ? AND network = 'TIGEREX' AND account_type = ?")
    .get(asset.toUpperCase(), accountType) as { balance: number } | undefined;
  return Number(row?.balance) || 0;
}

/** Move an amount into a protocol reward account, creating it on first use. */
export function creditFund(accountType: string, asset: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  creditTreasury(asset, amount, accountType);
}

/** Draw an amount out of a protocol reward account, failing closed when short. */
export function debitFund(accountType: string, asset: string, amount: number): void {
  if (amount <= 0) return;
  const db = getDb();
  const row = db
    .prepare("SELECT account_id, balance FROM treasury_accounts WHERE asset = ? AND network = 'TIGEREX' AND account_type = ?")
    .get(asset.toUpperCase(), accountType) as { account_id: string; balance: number } | undefined;
  if (!row || Number(row.balance) + 1e-9 < amount) {
    throw new DexError('REWARD_FUND_EMPTY', `the ${asset} reward fund cannot cover ${amount}`, 409);
  }
  db.prepare("UPDATE treasury_accounts SET balance = balance - ?, updated_at = datetime('now') WHERE account_id = ?").run(amount, row.account_id);
}

/** Read a numeric protocol setting, falling back to a documented default. */
export function dexSetting(key: string, fallback: number): number {
  const row = getDb().prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read a boolean protocol setting. */
export function dexSettingBool(key: string, fallback: boolean): boolean {
  const row = getDb().prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  return row.value === 'true' || row.value === '1';
}

export { AmmError };
