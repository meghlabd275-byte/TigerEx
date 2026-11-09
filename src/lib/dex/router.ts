/**
 * TigerSwap aggregator and smart router.
 *
 * Builds a routing graph from TigerSwap's own pools (V2, Stable, Weighted,
 * Concentrated) and finds the best execution path for a trade: multi-hop across
 * intermediate tokens, and split across several routes when no single route is
 * the cheapest for the whole size. No external aggregator or DEX API is
 * consulted; the graph is entirely local.
 */

import {
  AmmError,
  v2GetAmountOut,
  stableSwap,
  weightedGetAmountOut,
  v3SwapStep,
  type V2Reserves,
  type StablePool,
  type WeightedPool,
  type V3PoolState,
} from '@/lib/dex/amm';

export type PoolKind = 'v2' | 'stable' | 'weighted' | 'v3';

export interface V2PoolDefinition {
  kind: 'v2';
  /** Token symbol -> reserve, one entry per side. */
  reserves: Record<string, number>;
  fee: number;
}

export interface StablePoolDefinition {
  kind: 'stable';
  /** Ordered coin symbols, matching `balances` by index. */
  coins: string[];
  pool: StablePool;
  fee: number;
}

export interface WeightedPoolDefinition {
  kind: 'weighted';
  /** Ordered token symbols, matching `balances`/`weights` by index. */
  tokens: string[];
  pool: WeightedPool;
}

export interface V3PoolDefinition {
  kind: 'v3';
  /** token0 sells into token1 when selling token0. */
  token0: string;
  token1: string;
  state: V3PoolState;
}

export type PoolDefinition =
  | V2PoolDefinition
  | StablePoolDefinition
  | WeightedPoolDefinition
  | V3PoolDefinition;

export interface Pool {
  poolId: string;
  definition: PoolDefinition;
}

export interface HopQuote {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  fee: number;
  /** Square-root price the pool reaches after this hop; concentrated pools only. */
  sqrtPriceAfter?: number;
}

export interface RouteQuote {
  hops: HopQuote[];
  amountIn: number;
  amountOut: number;
  /** Total fee paid across the hops, in input-token units of each hop. */
  totalFee: number;
  priceImpact: number;
}

export interface AggregatedQuote {
  routes: RouteQuote[];
  amountIn: number;
  amountOut: number;
  /** Effective price: output per unit of input across all routes. */
  effectivePrice: number;
}

function tokensOf(definition: PoolDefinition): string[] {
  switch (definition.kind) {
    case 'v2':
      return Object.keys(definition.reserves);
    case 'stable':
      return definition.coins;
    case 'weighted':
      return definition.tokens;
    case 'v3':
      return [definition.token0, definition.token1];
  }
}

/** Whether a pool can trade the pair in either direction. */
export function poolSupports(pool: Pool, tokenIn: string, tokenOut: string): boolean {
  if (tokenIn === tokenOut) return false;
  const tokens = tokensOf(pool.definition);
  return tokens.includes(tokenIn) && tokens.includes(tokenOut);
}

/**
 * Quote a single pool for an exact input.
 *
 * Dispatches on the pool shape; a shape that cannot price the trade throws
 * rather than returning zero, so a caller never treats an unpriceable pool as a
 * zero-cost route.
 */
export function quotePool(
  pool: Pool,
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
): HopQuote {
  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'amountIn must be a positive finite number');
  }
  const d = pool.definition;

  if (d.kind === 'v2') {
    if (!(tokenIn in d.reserves) || !(tokenOut in d.reserves)) {
      throw new AmmError('UNSUPPORTED_PAIR', `${tokenIn}/${tokenOut} is not a pair in this pool`);
    }
    const reserves: V2Reserves = { reserveIn: d.reserves[tokenIn], reserveOut: d.reserves[tokenOut] };
    const amountOut = v2GetAmountOut(amountIn, reserves, d.fee);
    return { poolId: pool.poolId, tokenIn, tokenOut, amountIn, amountOut, fee: amountIn * d.fee };
  }

  if (d.kind === 'stable') {
    const inIndex = d.coins.indexOf(tokenIn);
    const outIndex = d.coins.indexOf(tokenOut);
    if (inIndex < 0 || outIndex < 0) {
      throw new AmmError('UNSUPPORTED_PAIR', `${tokenIn}/${tokenOut} is not a pair in this pool`);
    }
    const result = stableSwap(d.pool, inIndex, outIndex, amountIn, d.fee);
    return { poolId: pool.poolId, tokenIn, tokenOut, amountIn, amountOut: result.amountOut, fee: result.fee };
  }

  if (d.kind === 'weighted') {
    const inIndex = d.tokens.indexOf(tokenIn);
    const outIndex = d.tokens.indexOf(tokenOut);
    if (inIndex < 0 || outIndex < 0) {
      throw new AmmError('UNSUPPORTED_PAIR', `${tokenIn}/${tokenOut} is not a pair in this pool`);
    }
    const amountOut = weightedGetAmountOut(d.pool, inIndex, outIndex, amountIn);
    return { poolId: pool.poolId, tokenIn, tokenOut, amountIn, amountOut, fee: amountIn * d.pool.fee };
  }

  // Concentrated: token0 -> token1 is zeroForOne.
  const zeroForOne = tokenIn === d.token0 && tokenOut === d.token1;
  const oneForZero = tokenIn === d.token1 && tokenOut === d.token0;
  if (!zeroForOne && !oneForZero) {
    throw new AmmError('UNSUPPORTED_PAIR', `${tokenIn}/${tokenOut} is not a pair in this pool`);
  }
  const step = v3SwapStep(d.state, zeroForOne, amountIn);
  return {
    poolId: pool.poolId,
    tokenIn,
    tokenOut,
    amountIn: step.amountIn,
    amountOut: step.amountOut,
    fee: step.feePaid,
    sqrtPriceAfter: step.sqrtPriceAfter,
  };
}

interface Edge {
  pool: Pool;
  from: string;
  to: string;
}

/** Build a directed adjacency map from the pool set. */
function buildGraph(pools: Pool[]): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();
  const push = (from: string, to: string, pool: Pool) => {
    const list = graph.get(from) ?? [];
    list.push({ pool, from, to });
    graph.set(from, list);
  };
  for (const pool of pools) {
    const tokens = tokensOf(pool.definition);
    for (const a of tokens) {
      for (const b of tokens) {
        if (a === b) continue;
        push(a, b, pool);
      }
    }
  }
  return graph;
}

/**
 * Enumerate simple paths (no repeated token) up to `maxHops` edges.
 *
 * Bounded depth keeps the search cheap on a large graph while still finding the
 * common two- and three-hop routes; a token is never revisited, which also
 * prevents an infinite walk on a cyclic graph.
 */
function enumeratePaths(
  graph: Map<string, Edge[]>,
  tokenIn: string,
  tokenOut: string,
  maxHops: number,
): Edge[][] {
  const paths: Edge[][] = [];
  const visit = (node: string, path: Edge[], seen: Set<string>) => {
    if (path.length >= maxHops) return;
    for (const edge of graph.get(node) ?? []) {
      if (seen.has(edge.to)) continue;
      const next = [...path, edge];
      if (edge.to === tokenOut) {
        paths.push(next);
        continue;
      }
      seen.add(edge.to);
      visit(edge.to, next, seen);
      seen.delete(edge.to);
    }
  };
  visit(tokenIn, [], new Set([tokenIn]));
  return paths;
}

/** Execute a path sequentially, chaining the output of each hop into the next. */
export function quotePath(path: Edge[], amountIn: number): RouteQuote {
  const hops: HopQuote[] = [];
  let current = amountIn;
  for (const edge of path) {
    const hop = quotePool(edge.pool, edge.from, edge.to, current);
    if (hop.amountOut <= 0 || !Number.isFinite(hop.amountOut)) {
      throw new AmmError('NO_OUTPUT', `pool ${edge.pool.poolId} produced no output`);
    }
    hops.push(hop);
    current = hop.amountOut;
  }
  const totalFee = hops.reduce((acc, h) => acc + h.fee, 0);
  return {
    hops,
    amountIn,
    amountOut: current,
    totalFee,
    priceImpact: 0,
  };
}

export interface RouteOptions {
  /** Maximum number of hops (edges) in a path. */
  maxHops?: number;
  /** Maximum number of routes returned, best first. */
  maxRoutes?: number;
}

/**
 * Find the best routes from `tokenIn` to `tokenOut`.
 *
 * Every simple path up to `maxHops` is quoted and the results are sorted by
 * output. The first entry is the best single route; the rest are the candidates
 * the splitter can combine.
 */
export function findRoutes(
  pools: Pool[],
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
  options: RouteOptions = {},
): RouteQuote[] {
  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'amountIn must be a positive finite number');
  }
  if (tokenIn === tokenOut) throw new AmmError('INVALID_PAIR', 'input and output tokens must differ');

  const maxHops = options.maxHops ?? 3;
  const maxRoutes = options.maxRoutes ?? 4;
  const graph = buildGraph(pools);
  const paths = enumeratePaths(graph, tokenIn, tokenOut, maxHops);

  const quotes: RouteQuote[] = [];
  for (const path of paths) {
    try {
      quotes.push(quotePath(path, amountIn));
    } catch {
      // A path that cannot price (e.g. insufficient liquidity) is skipped; it is
      // not a zero-output route.
    }
  }
  quotes.sort((a, b) => b.amountOut - a.amountOut);
  return quotes.slice(0, maxRoutes);
}

/**
 * Split a trade across several routes to maximise total output.
 *
 * Water-filling: repeatedly add a small slice to the route whose marginal
 * output is currently highest, using a local finite-difference estimate of each
 * route's marginal rate. The allocation is recomputed from the routes' full
 * quotes, so the returned numbers are real outputs, not estimates.
 */
export function splitRoutes(
  pools: Pool[],
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
  routes: RouteQuote[],
  slices = 200,
): AggregatedQuote {
  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'amountIn must be a positive finite number');
  }
  if (routes.length === 0) throw new AmmError('NO_ROUTES', 'no route can serve this trade');
  if (routes.length === 1) {
    const only = routes[0];
    return {
      routes: [{ ...only, amountIn }],
      amountIn,
      amountOut: quoteByHops(pools, only.hops, amountIn).amountOut,
      effectivePrice: quoteByHops(pools, only.hops, amountIn).amountOut / amountIn,
    };
  }

  const epsilon = amountIn / (slices * 50);
  const allocation = routes.map(() => 0);
  const slice = amountIn / slices;

  for (let step = 0; step < slices; step += 1) {
    let bestIndex = 0;
    let bestRate = -Infinity;
    for (let i = 0; i < routes.length; i += 1) {
      const base = allocation[i];
      try {
        const outBase = reQuote(pools, routes[i].hops, base);
        const outNext = reQuote(pools, routes[i].hops, base + epsilon);
        const rate = (outNext - outBase) / epsilon;
        if (Number.isFinite(rate) && rate > bestRate) {
          bestRate = rate;
          bestIndex = i;
        }
      } catch {
        // Route is saturated at its current size; it cannot take more.
      }
    }
    if (!Number.isFinite(bestRate)) break;
    allocation[bestIndex] += slice;
  }

  const used: RouteQuote[] = [];
  let totalOut = 0;
  let totalIn = 0;
  for (let i = 0; i < routes.length; i += 1) {
    if (allocation[i] <= 0) continue;
    const quote = reQuoteRoute(pools, routes[i].hops, allocation[i]);
    used.push(quote);
    totalOut += quote.amountOut;
    totalIn += allocation[i];
  }
  if (totalIn <= 0) throw new AmmError('NO_ROUTES', 'the splitter allocated nothing');
  return {
    routes: used,
    amountIn: totalIn,
    amountOut: totalOut,
    effectivePrice: totalOut / totalIn,
  };
}

function reQuote(pools: Pool[], hops: HopQuote[], amountIn: number): number {
  if (amountIn <= 0) return 0;
  return reQuoteRoute(pools, hops, amountIn).amountOut;
}

/** Re-price an existing hop chain at a new input size against the live pools. */
function reQuoteRoute(pools: Pool[], hops: HopQuote[], amountIn: number): RouteQuote {
  const byId = new Map(pools.map((p) => [p.poolId, p]));
  const rebuilt: HopQuote[] = [];
  let current = amountIn;
  for (const hop of hops) {
    const pool = byId.get(hop.poolId);
    if (!pool) throw new AmmError('UNKNOWN_POOL', `pool ${hop.poolId} is not available`);
    const next = quotePool(pool, hop.tokenIn, hop.tokenOut, current);
    rebuilt.push(next);
    current = next.amountOut;
  }
  return {
    hops: rebuilt,
    amountIn,
    amountOut: current,
    totalFee: rebuilt.reduce((acc, h) => acc + h.fee, 0),
    priceImpact: 0,
  };
}

function quoteByHops(pools: Pool[], hops: HopQuote[], amountIn: number): RouteQuote {
  return reQuoteRoute(pools, hops, amountIn);
}

/**
 * Full aggregation: find routes, then split across them for the best total.
 *
 * Returns the single best route when splitting does not improve on it, so a
 * caller never pays extra hops for no benefit.
 */
export function aggregate(
  pools: Pool[],
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
  options: RouteOptions = {},
): AggregatedQuote {
  const routes = findRoutes(pools, tokenIn, tokenOut, amountIn, options);
  if (routes.length === 0) throw new AmmError('NO_ROUTES', 'no route connects the two tokens');

  const best = routes[0];
  const bestSingle: AggregatedQuote = {
    routes: [best],
    amountIn,
    amountOut: best.amountOut,
    effectivePrice: best.amountOut / amountIn,
  };

  const split = splitRoutes(pools, tokenIn, tokenOut, amountIn, routes);
  return split.amountOut > bestSingle.amountOut ? split : bestSingle;
}
