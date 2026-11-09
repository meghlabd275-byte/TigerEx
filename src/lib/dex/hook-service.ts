/**
 * TigerSwap V4 hook settlement.
 *
 * A hook is a piece of pool-local logic: a dynamic fee, an on-chain limit order,
 * a TWAMM schedule, an anti-MEV gate. The decision rules live in `hooks.ts` and
 * are pure. This module is the settlement half: it stores a hook against a pool
 * in `dex_pool_hooks`, measures a pool's realised volatility from the swaps the
 * venue actually settled, and turns the hooks into the fee a pool should charge.
 *
 * The dynamic fee is the only hook that changes what a trader pays, so it is the
 * one applied on the swap path. The others gate or schedule; they are surfaced
 * here so the operator can see whether they would fire.
 */

import { getDb, generateId } from '@/lib/db';
import { DexError, loadPool, dexSetting, parseObject, parseStringArray } from '@/lib/dex/pool-service';
import {
  dynamicFee,
  shouldFireLimit,
  twammSlice,
  antiMevCheck,
  composeHooks,
  type DynamicFeeConfig,
  type HookKind,
} from '@/lib/dex/hooks';

export interface HookRow {
  hook_id: string;
  pool_id: string;
  kind: HookKind;
  config: string;
  status: string;
}

export interface HookDetail {
  hookId: string;
  poolId: string;
  kind: HookKind;
  config: Record<string, number>;
  status: string;
}

const HOOK_KINDS: HookKind[] = ['dynamicFee', 'limitOrder', 'twamm', 'antiMev'];

function parseConfig(raw: string): Record<string, number> {
  const value = parseObject(raw, 'hook config');
  for (const [key, entry] of Object.entries(value)) {
    if (!Number.isFinite(entry)) {
      throw new DexError('CORRUPT_HOOK', `hook config field ${key} is not a number`, 500);
    }
  }
  return value;
}

/** Every hook attached to a pool, active or not. */
export function listHooks(poolId?: string): HookDetail[] {
  const db = getDb();
  const rows = (
    poolId
      ? db.prepare('SELECT * FROM dex_pool_hooks WHERE pool_id = ? ORDER BY created_at ASC').all(poolId)
      : db.prepare('SELECT * FROM dex_pool_hooks ORDER BY created_at ASC').all()
  ) as HookRow[];
  return rows.map((row) => ({
    hookId: row.hook_id,
    poolId: row.pool_id,
    kind: row.kind,
    config: parseConfig(row.config),
    status: row.status,
  }));
}

/**
 * Attach a hook to a pool, replacing any hook of the same kind.
 *
 * A pool may carry at most one hook of each kind: two dynamic-fee hooks would
 * each compute a fee and the result would depend on evaluation order. The
 * configuration is validated by running the hook once against a probe input, so
 * a hook that would throw at swap time cannot be stored.
 */
export function setHook(request: {
  poolId: string;
  kind: string;
  config: Record<string, unknown>;
}): HookDetail {
  const row = loadPool(request.poolId);
  const kind = String(request.kind) as HookKind;
  if (!HOOK_KINDS.includes(kind)) {
    throw new DexError('INVALID_HOOK', `unknown hook kind ${request.kind}`, 400);
  }

  const config: Record<string, number> = {};
  for (const [key, value] of Object.entries(request.config ?? {})) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new DexError('INVALID_HOOK', `hook config ${key} must be a number`, 400);
    config[key] = n;
  }

  // Validate by exercising the hook's rule with the stored config. A bad config
  // throws here rather than on the first swap that touches the pool.
  try {
    validateHook(kind, config);
  } catch (error) {
    throw new DexError('INVALID_HOOK', (error as Error).message, 400);
  }

  const db = getDb();
  const hookId = generateId();
  db.prepare(
    `INSERT INTO dex_pool_hooks (hook_id, pool_id, kind, config, status)
     VALUES (?, ?, ?, ?, 'active')
     ON CONFLICT(pool_id, kind) DO UPDATE SET config = excluded.config, status = 'active', updated_at = datetime('now')`,
  ).run(hookId, row.pool_id, kind, JSON.stringify(config));

  const stored = db
    .prepare('SELECT * FROM dex_pool_hooks WHERE pool_id = ? AND kind = ?')
    .get(row.pool_id, kind) as HookRow;
  return { hookId: stored.hook_id, poolId: stored.pool_id, kind: stored.kind, config: parseConfig(stored.config), status: stored.status };
}

function validateHook(kind: HookKind, config: Record<string, number>): void {
  if (kind === 'dynamicFee') {
    dynamicFee(
      { baseFee: config.baseFee, maxFee: config.maxFee, volatilityCeiling: config.volatilityCeiling },
      0,
    );
  } else if (kind === 'antiMev') {
    antiMevCheck({ blockOpenPrice: 1, currentPrice: 1, tolerance: config.tolerance }, 'buy');
  } else if (kind === 'limitOrder') {
    shouldFireLimit(
      { orderId: 'probe', side: 'buy', triggerPrice: config.triggerPrice, amountIn: config.amountIn, filled: false },
      config.triggerPrice,
    );
  } else if (kind === 'twamm') {
    twammSlice(
      {
        remainingIn: config.remainingIn,
        durationSeconds: config.durationSeconds,
        startedAt: 0,
        lastExecutedAt: 0,
      },
      1,
    );
  }
}

/** Detach a hook from a pool. */
export function removeHook(poolId: string, kind: string): { removed: boolean } {
  const result = getDb().prepare('DELETE FROM dex_pool_hooks WHERE pool_id = ? AND kind = ?').run(poolId, kind);
  return { removed: result.changes > 0 };
}

/**
 * A pool's realised volatility, from its own settled swaps.
 *
 * Volatility is the standard deviation of successive swap prices, expressed as a
 * fraction of the mean. It is measured from `dex_swaps`, so it reflects the
 * market the venue actually served; a pool with no history has no volatility and
 * the dynamic fee stays at its base.
 */
export function poolVolatility(poolId: string, lookback = 50): number {
  const rows = getDb()
    .prepare(
      `SELECT amount_in, amount_out FROM dex_swaps
        WHERE pool_id = ? AND amount_in > 0 AND amount_out > 0
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(poolId, lookback) as Array<{ amount_in: number; amount_out: number }>;

  if (rows.length < 2) return 0;

  const prices = rows.map((row) => row.amount_out / row.amount_in).reverse();
  const mean = prices.reduce((acc, p) => acc + p, 0) / prices.length;
  if (mean <= 0) return 0;
  const variance = prices.reduce((acc, p) => acc + (p - mean) ** 2, 0) / prices.length;
  return Math.sqrt(variance) / mean;
}

/**
 * The fee a pool should charge for a swap right now.
 *
 * The pool's stored fee is the base. A dynamic-fee hook may widen it using the
 * pool's realised volatility, capped by the hook's own ceiling. Any other hook
 * kind leaves the fee alone. The returned value is the fee actually applied, so
 * the caller cannot accidentally charge the base while believing the hook ran.
 */
export function effectiveFee(poolId: string): { fee: number; baseFee: number; applied: string[] } {
  const row = loadPool(poolId);
  const baseFee = Number(row.fee);
  const hooks = listHooks(poolId).filter((hook) => hook.status === 'active');
  const applied: string[] = [];
  let fee = baseFee;

  const dynamic = hooks.find((hook) => hook.kind === 'dynamicFee');
  if (dynamic) {
    const volatility = poolVolatility(poolId);
    fee = hookFee(baseFee, dynamic.config, volatility);
    applied.push('dynamicFee');
  }

  return { fee, baseFee, applied };
}

/**
 * The fee a dynamic-fee hook charges for a base fee, its config and a measured
 * volatility. The configured ceiling caps the fee, so a hook cannot be stored
 * with a maxFee that lets it charge an unbounded fraction.
 */
export function hookFee(baseFee: number, config: Record<string, number>, volatility: number): number {
  const maxBps = dexSetting('dex_v4_dynamic_fee_max_bps', 100);
  const ceiling = dexSetting('dex_v4_volatility_ceiling', 0.05);
  const resolved: DynamicFeeConfig = {
    baseFee: config.baseFee ?? baseFee,
    maxFee: config.maxFee ?? Math.min(0.99, baseFee + maxBps / 10_000),
    volatilityCeiling: config.volatilityCeiling ?? ceiling,
  };
  return dynamicFee(resolved, volatility);
}

/**
 * The effective fee for every pool that carries an active dynamic-fee hook.
 *
 * A pool with no such hook is absent, so the swap path can apply the override
 * only where one exists and the common case stays a single query.
 */
export function feeOverrides(): Map<string, number> {
  const db = getDb();
  const hooks = db
    .prepare("SELECT pool_id, config FROM dex_pool_hooks WHERE kind = 'dynamicFee' AND status = 'active'")
    .all() as Array<{ pool_id: string; config: string }>;
  const overrides = new Map<string, number>();
  if (hooks.length === 0) return overrides;

  const feeStmt = db.prepare('SELECT fee FROM dex_pools WHERE pool_id = ?');
  for (const hook of hooks) {
    const pool = feeStmt.get(hook.pool_id) as { fee: number } | undefined;
    if (!pool) continue;
    overrides.set(hook.pool_id, hookFee(Number(pool.fee), parseConfig(hook.config), poolVolatility(hook.pool_id)));
  }
  return overrides;
}

export interface HookEvaluation {
  poolId: string;
  fee: number;
  baseFee: number;
  applied: string[];
  volatility: number;
  limit?: { fire: boolean; reason: string };
  twamm?: { slice: number };
  antiMev?: { allowed: boolean; reason: string };
}

/**
 * Evaluate every active hook on a pool for the current state.
 *
 * This is the read-only view an operator uses to see what the hooks would do
 * before a swap arrives. It never moves funds.
 */
export function evaluateHooks(
  poolId: string,
  context: { currentPrice?: number; side?: 'buy' | 'sell'; now?: number } = {},
): HookEvaluation {
  const row = loadPool(poolId);
  const tokens = parseStringArray(row.tokens, 'tokens');
  const reserves = parseObject(row.reserves, 'reserves');
  const { fee, baseFee, applied } = effectiveFee(poolId);
  const volatility = poolVolatility(poolId);
  const hooks = listHooks(poolId).filter((hook) => hook.status === 'active');

  const result: HookEvaluation = { poolId, fee, baseFee, applied, volatility };

  const limit = hooks.find((hook) => hook.kind === 'limitOrder');
  if (limit) {
    const price = context.currentPrice ?? reserveRatio(tokens, reserves);
    result.limit = shouldFireLimit(
      {
        orderId: limit.hookId,
        side: limit.config.side === 1 ? 'sell' : 'buy',
        triggerPrice: limit.config.triggerPrice,
        amountIn: limit.config.amountIn,
        filled: false,
      },
      price,
    );
  }

  const twamm = hooks.find((hook) => hook.kind === 'twamm');
  if (twamm) {
    result.twamm = {
      slice: twammSlice(
        {
          remainingIn: twamm.config.remainingIn,
          durationSeconds: twamm.config.durationSeconds,
          startedAt: twamm.config.startedAt ?? 0,
          lastExecutedAt: twamm.config.lastExecutedAt ?? 0,
        },
        context.now ?? Date.now() / 1000,
      ),
    };
  }

  const antiMev = hooks.find((hook) => hook.kind === 'antiMev');
  if (antiMev) {
    const price = context.currentPrice ?? reserveRatio(tokens, reserves);
    result.antiMev = antiMevCheck(
      { blockOpenPrice: price, currentPrice: price, tolerance: antiMev.config.tolerance },
      context.side ?? 'buy',
    );
  }

  return result;
}

/** Spot ratio of the second token to the first, for pools that have two. */
function reserveRatio(tokens: string[], reserves: Record<string, number>): number {
  if (tokens.length < 2) return 1;
  const a = reserves[tokens[0]] ?? 0;
  const b = reserves[tokens[1]] ?? 0;
  if (a <= 0 || b <= 0) return 1;
  return b / a;
}

/** Re-export so callers can compose hooks without importing two modules. */
export { composeHooks };
