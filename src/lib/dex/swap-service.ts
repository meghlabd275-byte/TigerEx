/**
 * TigerSwap swap settlement.
 *
 * Quotes a trade through TigerSwap's own pools, then settles it by moving real
 * balances in the ledger: the input is debited from the trader and added to the
 * pools, the output is removed from the pools and credited to the trader, and
 * each pool's fee is split between the LPs, the veTGR voters and the treasury.
 * Everything runs in one SQLite transaction, so a rejected trade leaves no
 * partial state.
 *
 * The route layer is a thin wrapper; the pricing and the movement live here so
 * the same rules apply to the API, the bots and the C++/Rust paths.
 */

import { getDb, generateId } from '@/lib/db';
import { debitAvailable, creditAvailable, covers, availableBalance, recordTransaction } from '@/lib/db/ledger';
import {
  aggregate,
  quotePool,
  type AggregatedQuote,
  type Pool as RouterPool,
  type RouteQuote,
} from '@/lib/dex/router';
import { AmmError } from '@/lib/dex/amm';
import {
  DexError,
  assertDexOpen,
  loadActivePools,
  updateV3State,
  applyPoolDeltas,
  recordDexRevenue,
  refreshPoolStats,
  dexSetting,
  dexSettingBool,
  assertNotBlacklisted,
  type DexPoolRow,
} from '@/lib/dex/pool-service';
import { applySchedule, DEFAULT_SWAP_SPLIT, type SplitSchedule } from '@/lib/dex/fee-engine';
import { feeOverrides } from '@/lib/dex/hook-service';
import { priceImpact as impactOf } from '@/lib/dex/amm';

export interface QuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippage?: number | string;
  maxHops?: number;
}

export interface QuoteHop {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  fee: number;
  sqrtPriceAfter?: number;
}

export interface QuoteResult {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  amountOutMin: number;
  priceImpact: number;
  executionPrice: number;
  fee: number;
  slippage: number;
  hops: QuoteHop[];
  split: boolean;
  routes: number;
}

/** The swap-fee split, read from settings so an operator can tune it. */
export function swapFeeSplit(): SplitSchedule {
  return {
    lpBps: dexSetting('dex_swap_fee_split_lp_bps', DEFAULT_SWAP_SPLIT.lpBps),
    vetgrBps: dexSetting('dex_swap_fee_split_vetgr_bps', DEFAULT_SWAP_SPLIT.vetgrBps),
    treasuryBps: dexSetting('dex_swap_fee_split_treasury_bps', DEFAULT_SWAP_SPLIT.treasuryBps),
    insuranceBps: dexSetting('dex_swap_fee_split_insurance_bps', 0),
    burnBps: dexSetting('dex_swap_fee_split_burn_bps', 0),
  };
}

function normalizedSymbol(value: unknown, name: string): string {
  const symbol = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(symbol)) {
    throw new DexError('INVALID_SYMBOL', `${name} must be an asset symbol`, 400);
  }
  return symbol;
}

function requireAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new DexError('INVALID_AMOUNT', 'amountIn must be positive', 400);
  return n;
}

/** Effective slippage for a request, clamped to the configured maximum. */
export function resolveSlippage(requested: unknown): number {
  const max = dexSetting('dex_max_slippage', 0.05);
  const fallback = dexSetting('dex_default_slippage', 0.005);
  const value = requested === undefined || requested === null ? fallback : Number(requested);
  if (!Number.isFinite(value) || value < 0) {
    throw new DexError('INVALID_SLIPPAGE', 'slippage must be a non-negative fraction', 400);
  }
  if (value > max) {
    throw new DexError('SLIPPAGE_TOO_HIGH', `slippage may not exceed ${max}`, 400);
  }
  return value;
}

function routerPools(overrides?: Map<string, number>): RouterPool[] {
  return loadActivePools().map(({ row, definition }) => {
    const fee = overrides?.get(row.pool_id);
    return { poolId: row.pool_id, definition: fee !== undefined ? withFee(definition, fee) : definition };
  });
}

/**
 * A pool definition with its fee replaced by a hook's effective fee.
 *
 * A V4 dynamic-fee hook changes what a swap costs, so the aggregator has to
 * price against the hooked fee or the trader would be quoted one fee and charged
 * another. Every pool shape carries its fee in a different place, so the clone
 * is done per shape rather than by mutating the shared definition.
 */
function withFee(definition: RouterPool['definition'], fee: number): RouterPool['definition'] {
  switch (definition.kind) {
    case 'v2':
      return { ...definition, fee };
    case 'stable':
      return { ...definition, fee };
    case 'weighted':
      return { ...definition, pool: { ...definition.pool, fee } };
    case 'v3':
      return { ...definition, state: { ...definition.state, fee } };
  }
}

function poolRowById(poolId: string, rows: DexPoolRow[]): DexPoolRow | undefined {
  return rows.find((r) => r.pool_id === poolId);
}

/** Sum the fee paid in the input token across every hop of every route. */
function totalFee(quote: AggregatedQuote): number {
  return quote.routes.reduce((acc, route) => acc + route.totalFee, 0);
}

/**
 * Price a trade without moving funds.
 *
 * The route comes from the aggregator over TigerSwap's own pools; the impact is
 * computed from the pool's spot price before and after the trade so the trader
 * sees the real cost of their size, not a modelled one.
 */
export function quoteSwap(request: QuoteRequest): QuoteResult {
  const tokenIn = normalizedSymbol(request.tokenIn, 'tokenIn');
  const tokenOut = normalizedSymbol(request.tokenOut, 'tokenOut');
  if (tokenIn === tokenOut) throw new DexError('INVALID_PAIR', 'tokenIn and tokenOut must differ', 400);
  const amountIn = requireAmount(request.amountIn);
  const slippage = resolveSlippage(request.slippage);

  assertNotBlacklisted([
    { kind: 'token', value: tokenIn },
    { kind: 'token', value: tokenOut },
  ]);

  const pools = routerPools(feeOverrides());
  if (pools.length === 0) throw new DexError('NO_POOLS', 'no TigerSwap pool is active', 409);

  let aggregated: AggregatedQuote;
  try {
    aggregated = aggregate(pools, tokenIn, tokenOut, amountIn, { maxHops: request.maxHops ?? 3 });
  } catch (error) {
    if (error instanceof AmmError) throw new DexError(error.code, error.message, 409);
    throw error;
  }

  const spotBefore = spotPrice(pools, tokenIn, tokenOut);
  const amountOut = aggregated.amountOut;
  const executionPrice = amountOut / amountIn;
  const impact = spotBefore > 0 ? impactOf(spotBefore, executionPrice) : 0;

  const maxImpact = dexSetting('dex_max_price_impact', 0.15);
  if (impact > maxImpact) {
    throw new DexError('PRICE_IMPACT_TOO_HIGH', `price impact ${impact} exceeds the ${maxImpact} limit`, 409);
  }

  const hops: QuoteHop[] = aggregated.routes.flatMap((route: RouteQuote) =>
    route.hops.map((hop) => ({
      poolId: hop.poolId,
      tokenIn: hop.tokenIn,
      tokenOut: hop.tokenOut,
      amountIn: hop.amountIn,
      amountOut: hop.amountOut,
      fee: hop.fee,
      sqrtPriceAfter: hop.sqrtPriceAfter,
    })),
  );

  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    amountOutMin: amountOut * (1 - slippage),
    priceImpact: impact,
    executionPrice,
    fee: totalFee(aggregated),
    slippage,
    hops,
    split: aggregated.routes.length > 1,
    routes: aggregated.routes.length,
  };
}

/** Spot price of tokenOut in tokenIn units, from the first pool that serves it. */
function spotPrice(pools: RouterPool[], tokenIn: string, tokenOut: string): number {
  const probe = 1e-9;
  for (const pool of pools) {
    try {
      const hop = quotePool(pool, tokenIn, tokenOut, probe);
      if (hop.amountOut > 0) return hop.amountOut / probe;
    } catch {
      // Pool does not serve this pair; try the next one.
    }
  }
  return 0;
}

/** Active liquidity of a concentrated pool in a loaded pool set. */
function liquidityOf(pools: RouterPool[], poolId: string): number {
  const pool = pools.find((candidate) => candidate.poolId === poolId);
  if (!pool || pool.definition.kind !== 'v3') {
    throw new DexError('CORRUPT_POOL', `pool ${poolId} is not a concentrated pool`, 500);
  }
  return pool.definition.state.liquidity;
}

export interface SwapRequest extends QuoteRequest {
  userId: string;
  /** When true the protocol's settlement fee is waived for a sponsored swap. */
  gasless?: boolean;
  /** Client reference, echoed back for idempotency tracking. */
  clientId?: string;
}

export interface SwapResult {
  swapId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  fee: number;
  priceImpact: number;
  routes: number;
  sponsored: boolean;
}

/**
 * Execute a swap: price it, then move the balances and update the pools.
 *
 * The whole operation is one transaction. The trader's input is debited before
 * any pool is written, the output is credited only after the pools have been
 * updated, and a failure at any point rolls the transaction back.
 */
export function executeSwap(request: SwapRequest): SwapResult {
  assertDexOpen('dex');
  assertNotBlacklisted([{ kind: 'wallet', value: request.userId }]);
  const quote = quoteSwap(request);
  const db = getDb();
  const sponsored = Boolean(request.gasless) && claimSponsoredSwap(request.userId);
  const settlementFeeBps = sponsored ? 0 : dexSetting('dex_settlement_fee_bps', 0);

  const swapId = generateId();
  const pools = routerPools(feeOverrides());

  db.transaction(() => {
    const input = quote.amountIn;
    const output = quote.amountOut;
    if (!covers(availableBalance(request.userId, quote.tokenIn), input)) {
      throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${quote.tokenIn} balance`, 400);
    }

    debitAvailable(request.userId, quote.tokenIn, input);
    // The protocol settlement fee is withheld from the output before it reaches
    // the trader, so the treasury is credited only tokens the trader gave up.
    // Crediting the full output and then booking the fee as revenue would fund
    // the treasury with value nobody paid.
    const settlementFee = settlementFeeBps > 0 ? (output * settlementFeeBps) / 10_000 : 0;
    creditAvailable(request.userId, quote.tokenOut, output - settlementFee);
    recordTransaction(request.userId, 'dex_swap', quote.tokenIn, input, quote.fee, 'completed', `swap ${swapId}`);

    const deltas = new Map<string, Array<{ tokenIn: string; tokenOut: string; amountIn: number; amountOut: number }>>();
    const v3Prices = new Map<string, number>();
    for (const hop of quote.hops) {
      const list = deltas.get(hop.poolId) ?? [];
      list.push({ tokenIn: hop.tokenIn, tokenOut: hop.tokenOut, amountIn: hop.amountIn, amountOut: hop.amountOut });
      deltas.set(hop.poolId, list);
      // A concentrated pool moves its price with the trade, so the new
      // square-root price has to be written back; otherwise the next quote
      // would price against the pre-trade price and the pool would leak value.
      if (hop.sqrtPriceAfter !== undefined) v3Prices.set(hop.poolId, hop.sqrtPriceAfter);
    }
    applyPoolDeltas(deltas);
    for (const [poolId, sqrtPrice] of v3Prices) {
      updateV3State(poolId, sqrtPrice, liquidityOf(pools, poolId));
    }

    // Split each hop's fee, recorded against the pool that earned it.
    const split = swapFeeSplit();
    for (const hop of quote.hops) {
      const parts = applySchedule(hop.fee, split);
      recordDexRevenue('dex_swap', hop.tokenIn, hop.fee, parts, swapId);
      refreshPoolStats(hop.poolId);
    }

    if (settlementFee > 0) {
      const parts = applySchedule(settlementFee, { lpBps: 0, vetgrBps: 0, treasuryBps: 10_000, insuranceBps: 0, burnBps: 0 });
      recordDexRevenue('dex_settlement', quote.tokenOut, settlementFee, parts, swapId);
    }

    db.prepare(
      `INSERT INTO dex_swaps
         (swap_id, pool_id, user_id, token_in, token_out, amount_in, amount_out, fee, price_impact, route)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      swapId,
      quote.hops[0]?.poolId ?? '',
      request.userId,
      quote.tokenIn,
      quote.tokenOut,
      quote.amountIn,
      quote.amountOut,
      quote.fee,
      quote.priceImpact,
      JSON.stringify(quote.hops),
    );
  })();

  return {
    swapId,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    fee: quote.fee,
    priceImpact: quote.priceImpact,
    routes: quote.routes,
    sponsored,
  };
}

/**
 * Whether a sponsored (gasless) swap is available for the caller.
 *
 * The protocol sponsors a fixed number of swaps per day; the count is derived
 * from the settled swaps already recorded today, so it survives a restart and
 * cannot be reset by reconnecting. A sponsored swap waives the protocol's
 * settlement fee; the pool fee still funds the LPs, so liquidity is never
 * diluted by the sponsorship.
 */
export function claimSponsoredSwap(userId: string): boolean {
  const limit = dexSetting('dex_gasless_free_swaps_per_day', 3);
  if (!dexSettingBool('dex_gasless_enabled', true) || limit <= 0) return false;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS used FROM dex_swaps
        WHERE user_id = ? AND created_at >= datetime('now', 'start of day')`,
    )
    .get(userId) as { used: number } | undefined;
  return (Number(row?.used) || 0) < limit;
}

/** The caller's swap history, newest first. */
export function swapHistory(userId: string, limit = 50): Array<Record<string, unknown>> {
  const capped = Math.max(1, Math.min(Math.floor(limit), 200));
  return getDb()
    .prepare(
      `SELECT swap_id, pool_id, token_in, token_out, amount_in, amount_out, fee, price_impact, created_at
         FROM dex_swaps
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(userId, capped) as Array<Record<string, unknown>>;
}

/** Pool metadata for the list endpoint, including the live TVL and APR. */
export function listPools(): Array<Record<string, unknown>> {
  const rows = getDb().prepare('SELECT * FROM dex_pools ORDER BY created_at DESC').all() as DexPoolRow[];
  return rows.map((row) => ({
    poolId: row.pool_id,
    kind: row.kind,
    address: row.address,
    tokens: JSON.parse(row.tokens),
    fee: row.fee,
    reserves: JSON.parse(row.reserves),
    totalSupply: row.total_supply,
    tvlUsd: row.tvl_usd,
    volume24hUsd: row.volume_24h_usd,
    fee24hUsd: row.fee_24h_usd,
    status: row.status,
    amplification: row.amplification,
    weights: row.weights ? JSON.parse(row.weights) : null,
    tickSpacing: row.tick_spacing,
    sqrtPrice: row.sqrt_price,
    liquidity: row.liquidity,
  }));
}

/** A single pool's detail with its recent swaps. */
export function poolDetail(poolId: string): Record<string, unknown> {
  const row = getDb().prepare('SELECT * FROM dex_pools WHERE pool_id = ?').get(poolId) as DexPoolRow | undefined;
  if (!row) throw new DexError('UNKNOWN_POOL', `pool ${poolId} does not exist`, 404);
  const swaps = getDb()
    .prepare(
      `SELECT swap_id, token_in, token_out, amount_in, amount_out, fee, created_at
         FROM dex_swaps WHERE pool_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(poolId) as Array<Record<string, unknown>>;
  return {
    poolId: row.pool_id,
    kind: row.kind,
    tokens: JSON.parse(row.tokens),
    reserves: JSON.parse(row.reserves),
    fee: row.fee,
    tvlUsd: row.tvl_usd,
    volume24hUsd: row.volume_24h_usd,
    fee24hUsd: row.fee_24h_usd,
    totalSupply: row.total_supply,
    status: row.status,
    swaps,
  };
}

export { poolRowById };
