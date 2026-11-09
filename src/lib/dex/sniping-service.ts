/**
 * TigerSwap sniping bot settlement.
 *
 * A sniper buys a freshly created pool's token before the price has found its
 * level. The rules live in `sniping.ts` and are mostly refusal. This module is
 * the settlement half: it reads the venue's own pools for candidates, decides
 * which are eligible from the pool's real age, liquidity and status, sizes a
 * snipe against the pool's real reserves, and settles it through the same swap
 * path a manual trade uses.
 *
 * The candidate set is TigerSwap's own pools. There is no third-party launch
 * feed and no external mempool: "new" means a pool the venue itself created.
 */

import { getDb } from '@/lib/db';
import { DexError, loadPool, dexSetting, parseObject, parseStringArray, assertDexOpen } from '@/lib/dex/pool-service';
import { snipeEligibility, planSnipe, rankCandidates, type SnipeCandidate, type SnipePlan } from '@/lib/dex/sniping';
import { executeSwap, quoteSwap } from '@/lib/dex/swap-service';

export interface SnipeScanResult {
  policy: { windowSeconds: number; minLiquidity: number; maxImpact: number; gasMultiplier: number };
  candidates: Array<SnipeCandidate & { rank: number; score: number }>;
}

function policy(): { windowSeconds: number; minLiquidity: number; maxImpact: number; gasMultiplier: number } {
  return {
    windowSeconds: dexSetting('dex_snipe_window_seconds', 300),
    minLiquidity: dexSetting('dex_snipe_min_liquidity', 1000),
    maxImpact: dexSetting('dex_snipe_max_impact', 0.1),
    gasMultiplier: dexSetting('dex_snipe_gas_multiplier', 2),
  };
}

/** Epoch seconds from the pool's creation timestamp. */
function createdAtSeconds(createdAt: string | null): number {
  if (!createdAt) return 0;
  const ms = Date.parse(createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/**
 * List the pools that are eligible to be sniped, best first.
 *
 * A pool's input-token liquidity is its own reserve, and its age is measured
 * from the row's `created_at`, so the eligibility test runs on the venue's real
 * state. A blacklisted token makes its pool ineligible — the operator flagged it
 * for a reason and the bot honours that.
 */
export function scanSnipeCandidates(tokenIn: string, now = Math.floor(Date.now() / 1000)): SnipeScanResult {
  const input = String(tokenIn).trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(input)) throw new DexError('INVALID_SYMBOL', 'tokenIn must be an asset symbol', 400);

  const db = getDb();
  const blocked = new Set(
    (db.prepare("SELECT value FROM dex_blacklist WHERE kind = 'token'").all() as Array<{ value: string }>).map(
      (row) => row.value.toUpperCase(),
    ),
  );

  const rows = db.prepare("SELECT * FROM dex_pools WHERE status IN ('active', 'paused')").all() as Array<{
    pool_id: string;
    tokens: string;
    reserves: string;
    status: string;
    created_at: string | null;
  }>;

  const candidates: SnipeCandidate[] = [];
  for (const row of rows) {
    const tokens = parseStringArray(row.tokens, 'tokens');
    if (!tokens.includes(input)) continue;
    const reserves = parseObject(row.reserves, 'reserves');
    candidates.push({
      poolId: row.pool_id,
      createdAt: createdAtSeconds(row.created_at),
      liquidityIn: Number(reserves[input] ?? 0),
      tradingEnabled: row.status === 'active',
      flagged: tokens.some((token) => blocked.has(token)),
    });
  }

  const ranked = rankCandidates(candidates, policy(), now);
  const byId = new Map(candidates.map((candidate) => [candidate.poolId, candidate]));
  return {
    policy: policy(),
    candidates: ranked.map((entry, index) => ({
      ...(byId.get(entry.poolId) as SnipeCandidate),
      rank: index + 1,
      score: entry.score,
    })),
  };
}

export interface SnipeQuote extends SnipePlan {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  eligible: boolean;
}

/**
 * Size a snipe of one token into another through a specific pool.
 *
 * The plan is capped by the policy's impact limit, so the snipe can never be the
 * trade that moves the pool past what the operator authorised. The pool must
 * pass the eligibility test first; a pool that is old or flagged is refused
 * before any size is computed.
 */
export function quoteSnipe(request: {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippage?: number | string;
  now?: number;
}): SnipeQuote {
  const row = loadPool(request.poolId);
  const tokens = parseStringArray(row.tokens, 'tokens');
  const input = String(request.tokenIn).trim().toUpperCase();
  const output = String(request.tokenOut).trim().toUpperCase();
  if (!tokens.includes(input) || !tokens.includes(output) || input === output) {
    throw new DexError('INVALID_POOL', `${input}/${output} is not a pair in this pool`, 400);
  }
  if (row.kind !== 'v2') {
    throw new DexError('UNSUPPORTED_POOL', 'sniping is supported on constant-product pools', 400);
  }

  const now = request.now ?? Math.floor(Date.now() / 1000);
  const blocked = new Set(
    (getDb().prepare("SELECT value FROM dex_blacklist WHERE kind = 'token'").all() as Array<{ value: string }>).map(
      (r) => r.value.toUpperCase(),
    ),
  );
  const reserves = parseObject(row.reserves, 'reserves');
  const candidate: SnipeCandidate = {
    poolId: row.pool_id,
    createdAt: createdAtSeconds((row as unknown as { created_at: string | null }).created_at),
    liquidityIn: Number(reserves[input] ?? 0),
    tradingEnabled: row.status === 'active',
    flagged: tokens.some((token) => blocked.has(token)),
  };
  const eligibility = snipeEligibility(candidate, policy(), now);
  if (!eligibility.eligible) throw new DexError('NOT_SNIPEABLE', eligibility.reason, 409);

  const plan = planSnipe(
    request.amountIn,
    { reserveIn: Number(reserves[input]), reserveOut: Number(reserves[output]) },
    Number(row.fee),
    normalizeSlippage(request.slippage),
    { maxImpact: policy().maxImpact, gasMultiplier: policy().gasMultiplier },
  );

  return { ...plan, poolId: row.pool_id, tokenIn: input, tokenOut: output, eligible: true };
}

function normalizeSlippage(value: unknown): number {
  if (value === undefined || value === null) return dexSetting('dex_default_slippage', 0.005);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n >= 1) {
    throw new DexError('INVALID_SLIPPAGE', 'slippage must be a fraction in [0, 1)', 400);
  }
  return n;
}

export interface SnipeExecution {
  poolId: string;
  swapId: string;
  amountIn: number;
  amountOut: number;
  gasMultiplier: number;
}

/**
 * Execute a snipe: size it, then settle it on the normal swap path.
 *
 * The snipe is not a privileged trade. It settles through `executeSwap`, so it
 * pays the same fee, respects the same pause and blacklist checks and moves the
 * same ledger balances as a manual swap. The only difference is that the size
 * was chosen by the impact cap rather than typed by a trader.
 */
export function executeSnipe(request: {
  userId: string;
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippage?: number | string;
  now?: number;
}): SnipeExecution {
  assertDexOpen('dex');
  const quote = quoteSnipe(request);
  // Re-price through the router so the trade the venue settles is the one the
  // router would have quoted; the plan's size is the only thing it contributes.
  const routed = quoteSwap({
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    slippage: request.slippage,
  });
  const result = executeSwap({
    userId: request.userId,
    tokenIn: routed.tokenIn,
    tokenOut: routed.tokenOut,
    amountIn: routed.amountIn,
    slippage: request.slippage,
  });
  return {
    poolId: quote.poolId,
    swapId: result.swapId,
    amountIn: result.amountIn,
    amountOut: result.amountOut,
    gasMultiplier: quote.gasMultiplier,
  };
}
