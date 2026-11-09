/**
 * TigerSwap bot execution.
 *
 * A bot instance is a row in `dex_bot_instances` that names a strategy and the
 * parameters for it. The decision for each strategy is the pure planner in
 * `./bots`; this module is the part that reads live venue state, feeds it to
 * the planner, and settles the result through the same services the API uses,
 * so a bot-driven trade moves balances exactly as a user-driven one does.
 *
 * Arbitrage and liquidation settle real trades. The market-maker, grid,
 * rebalancing and DCA instances are managed and evaluated here (their planned
 * orders are exposed for the caller to act on or to preview), which keeps the
 * parameters validated by the planner that will run them.
 */

import { getDb, generateId } from '@/lib/db';
import { DexError, loadActivePools, assertDexOpen, assertNotBlacklisted } from '@/lib/dex/pool-service';
import { quotePool, poolSupports, type Pool } from '@/lib/dex/router';
import { executeSwap } from '@/lib/dex/swap-service';
import { liquidateBorrow } from '@/lib/dex/margin-service';
import { priceInQuote } from '@/lib/trading/valuation';
import { healthFactor, liquidate } from '@/lib/dex/margin';
import {
  findArbitrage,
  liquidationCandidates,
  marketMakerQuote,
  planRebalance,
  needsRebalance,
  gridLevels,
  gridAction,
  twapSlices,
  martingaleAmount,
  infinityGridLevels,
  dcaShouldBuy,
  type ArbOpportunity,
  type MarketMakerConfig,
  type TargetWeight,
  type LiquidationCandidate,
} from '@/lib/dex/bots';

export type BotType =
  | 'arbitrage'
  | 'market_maker'
  | 'grid'
  | 'infinity_grid'
  | 'dca'
  | 'martingale'
  | 'twap'
  | 'rebalance'
  | 'liquidation';

const BOT_TYPES: readonly BotType[] = [
  'arbitrage',
  'market_maker',
  'grid',
  'infinity_grid',
  'dca',
  'martingale',
  'twap',
  'rebalance',
  'liquidation',
];

export interface BotInstanceRow {
  instance_id: string;
  user_id: string;
  bot_type: string;
  pool_id: string | null;
  params: string;
  state: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function requireBotType(value: unknown): BotType {
  const type = String(value ?? '').trim().toLowerCase();
  if (!(BOT_TYPES as readonly string[]).includes(type)) {
    throw new DexError('INVALID_BOT_TYPE', `botType must be one of ${BOT_TYPES.join(', ')}`, 400);
  }
  return type as BotType;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DexError('INVALID_PARAMS', 'params must be a JSON object', 400);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new DexError('INVALID_PARAMS', `${name} must be a finite number`, 400);
  return n;
}

/** A trading bot must name the two assets it trades. */
function requirePair(params: Record<string, unknown>): void {
  if (!String(params.tokenIn ?? '').trim() || !String(params.tokenOut ?? '').trim()) {
    throw new DexError('INVALID_PARAMS', 'tokenIn and tokenOut are required', 400);
  }
}

/**
 * Validate a bot's parameters by running the planner that will consume them.
 *
 * The pure planners reject the same inputs at run time, so a bot that cannot
 * produce a decision is refused at creation rather than stored and left inert.
 */
export function validateBotParams(botType: BotType, params: Record<string, unknown>): void {
  switch (botType) {
    case 'grid':
      gridLevels({
        lowerPrice: asNumber(params.lowerPrice, 'lowerPrice'),
        upperPrice: asNumber(params.upperPrice, 'upperPrice'),
        levels: asNumber(params.levels, 'levels'),
        orderSize: asNumber(params.orderSize, 'orderSize'),
        spacing: params.spacing === 'geometric' ? 'geometric' : 'arithmetic',
      });
      requirePair(params);
      return;
    case 'infinity_grid':
      infinityGridLevels(
        {
          ratio: asNumber(params.ratio, 'ratio'),
          budget: asNumber(params.budget, 'budget'),
          depth: asNumber(params.depth, 'depth'),
        },
        1,
      );
      requirePair(params);
      return;
    case 'dca':
      if (!Number.isInteger(Number(params.lookback)) || Number(params.lookback) < 1) {
        throw new DexError('INVALID_PARAMS', 'lookback must be a positive integer', 400);
      }
      if (asNumber(params.amountIn, 'amountIn') <= 0) {
        throw new DexError('INVALID_PARAMS', 'amountIn must be positive', 400);
      }
      requirePair(params);
      return;
    case 'martingale':
      martingaleAmount(
        {
          baseAmount: asNumber(params.baseAmount, 'baseAmount'),
          multiplier: asNumber(params.multiplier, 'multiplier'),
          maxAmount: asNumber(params.maxAmount, 'maxAmount'),
        },
        0,
      );
      requirePair(params);
      return;
    case 'twap':
      twapSlices({
        totalQuantity: asNumber(params.totalQuantity, 'totalQuantity'),
        slices: asNumber(params.slices, 'slices'),
        intervalSeconds: asNumber(params.intervalSeconds, 'intervalSeconds'),
      });
      requirePair(params);
      return;
    case 'market_maker':
      marketMakerQuote(1, 0, 1, {
        spread: asNumber(params.spread, 'spread'),
        depth: asNumber(params.depth, 'depth'),
        rebalanceThreshold: asNumber(params.rebalanceThreshold, 'rebalanceThreshold'),
      });
      return;
    case 'rebalance': {
      const targets = params.targets;
      if (!Array.isArray(targets) || targets.length === 0) {
        throw new DexError('INVALID_PARAMS', 'targets must be a non-empty array', 400);
      }
      const parsed: TargetWeight[] = targets.map((entry, index) => {
        const record = asRecord(entry);
        return { token: String(record.token ?? ''), weight: asNumber(record.weight, `targets[${index}].weight`) };
      });
      planRebalance(
        parsed.map((t) => ({ token: t.token, value: 1 })),
        parsed,
      );
      return;
    }
    case 'arbitrage':
      if (!Number.isFinite(asNumber(params.maxAmountIn, 'maxAmountIn')) || asNumber(params.maxAmountIn, 'maxAmountIn') <= 0) {
        throw new DexError('INVALID_PARAMS', 'maxAmountIn must be positive', 400);
      }
      return;
    case 'liquidation':
      return;
  }
}

/** A user's bot instances, newest first. */
export function listBotInstances(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare('SELECT * FROM dex_bot_instances WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as BotInstanceRow[];
  return rows.map((row) => ({
    instanceId: row.instance_id,
    botType: row.bot_type,
    poolId: row.pool_id,
    params: JSON.parse(row.params) as Record<string, unknown>,
    state: JSON.parse(row.state) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** Create a bot instance whose parameters have been validated by its planner. */
export function createBotInstance(
  userId: string,
  input: { botType: unknown; poolId?: unknown; params?: unknown },
): Record<string, unknown> {
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const botType = requireBotType(input.botType);
  const params = asRecord(input.params ?? {});
  validateBotParams(botType, params);

  const poolId = input.poolId === undefined || input.poolId === null ? null : String(input.poolId);
  if (poolId !== null) {
    const pool = getDb().prepare('SELECT pool_id FROM dex_pools WHERE pool_id = ?').get(poolId);
    if (!pool) throw new DexError('UNKNOWN_POOL', `pool ${poolId} does not exist`, 404);
  }

  const instanceId = generateId();
  getDb()
    .prepare(
      `INSERT INTO dex_bot_instances (instance_id, user_id, bot_type, pool_id, params, state, status)
       VALUES (?, ?, ?, ?, ?, '{}', 'active')`,
    )
    .run(instanceId, userId, botType, poolId, JSON.stringify(params));
  return { instanceId, botType, poolId, params, status: 'active' };
}

/** Change a bot instance's status, scoped to its owner. */
export function setBotInstanceStatus(userId: string, instanceId: string, status: unknown): Record<string, unknown> {
  const next = String(status ?? '').trim().toLowerCase();
  if (!['active', 'paused', 'stopped'].includes(next)) {
    throw new DexError('INVALID_STATUS', 'status must be active, paused or stopped', 400);
  }
  const result = getDb()
    .prepare("UPDATE dex_bot_instances SET status = ?, updated_at = datetime('now') WHERE instance_id = ? AND user_id = ?")
    .run(next, instanceId, userId);
  if (result.changes === 0) throw new DexError('UNKNOWN_INSTANCE', 'bot instance does not exist', 404);
  return { instanceId, status: next };
}

/** Remove a bot instance, scoped to its owner. */
export function deleteBotInstance(userId: string, instanceId: string): { removed: boolean } {
  const result = getDb()
    .prepare('DELETE FROM dex_bot_instances WHERE instance_id = ? AND user_id = ?')
    .run(instanceId, userId);
  if (result.changes === 0) throw new DexError('UNKNOWN_INSTANCE', 'bot instance does not exist', 404);
  return { removed: true };
}

// ============================================================================
// Arbitrage
// ============================================================================

function livePools(): Pool[] {
  return loadActivePools().map(({ row, definition }) => ({ poolId: row.pool_id, definition }));
}

function quoteThrough(pool: Pool, tokenIn: string, tokenOut: string): (amountIn: number) => number {
  return (amountIn: number) => quotePool(pool, tokenIn, tokenOut, amountIn).amountOut;
}

/**
 * Every profitable two-pool arbitrage between TigerSwap's own pools.
 *
 * Pools are grouped by the unordered token pair they serve; within a group each
 * ordered pair of distinct pools is searched for a profit. The search covers
 * every pool shape, because the quote comes from the router's own `quotePool`.
 */
export function scanArbitrage(maxAmountIn: number, limit = 25): ArbOpportunity[] {
  if (!Number.isFinite(maxAmountIn) || maxAmountIn <= 0) {
    throw new DexError('INVALID_PARAMS', 'maxAmountIn must be positive', 400);
  }
  const pools = livePools();
  const byPair = new Map<string, Pool[]>();
  for (const pool of pools) {
    const tokens = tokensOf(pool);
    for (let i = 0; i < tokens.length; i += 1) {
      for (let j = i + 1; j < tokens.length; j += 1) {
        const key = [tokens[i], tokens[j]].sort().join('/');
        const list = byPair.get(key) ?? [];
        list.push(pool);
        byPair.set(key, list);
      }
    }
  }

  const found: ArbOpportunity[] = [];
  for (const group of byPair.values()) {
    if (group.length < 2) continue;
    const tokens = tokensOf(group[0]);
    for (let a = 0; a < tokens.length; a += 1) {
      for (let b = 0; b < tokens.length; b += 1) {
        if (a === b) continue;
        const tokenIn = tokens[a];
        const tokenOut = tokens[b];
        for (const buyPool of group) {
          if (!poolSupports(buyPool, tokenIn, tokenOut)) continue;
          for (const sellPool of group) {
            if (sellPool.poolId === buyPool.poolId) continue;
            if (!poolSupports(sellPool, tokenOut, tokenIn)) continue;
            try {
              const opportunity = findArbitrage(
                quoteThrough(buyPool, tokenIn, tokenOut),
                quoteThrough(sellPool, tokenOut, tokenIn),
                buyPool.poolId,
                sellPool.poolId,
                tokenIn,
                tokenOut,
                maxAmountIn,
              );
              if (opportunity) found.push(opportunity);
            } catch {
              // A pool that cannot price this pair or size is skipped.
            }
          }
        }
      }
    }
  }
  return found.sort((x, y) => y.profitRate - x.profitRate).slice(0, Math.max(1, limit));
}

export interface ArbitrageResult {
  buySwapId: string;
  sellSwapId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  profit: number;
}

/**
 * Settle an arbitrage between two of TigerSwap's own pools.
 *
 * The optimal size is re-derived from live state, then both legs settle in one
 * transaction: the buy leg's realised output funds the sell leg, so the profit
 * is measured against what actually moved rather than against the quote. A
 * failed sell leg rolls the buy back.
 */
export function runArbitrage(
  userId: string,
  input: { tokenIn: unknown; tokenOut: unknown; buyPoolId: unknown; sellPoolId: unknown; maxAmountIn: unknown },
): ArbitrageResult {
  assertDexOpen('dex');
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const tokenIn = String(input.tokenIn ?? '').trim().toUpperCase();
  const tokenOut = String(input.tokenOut ?? '').trim().toUpperCase();
  if (!tokenIn || !tokenOut || tokenIn === tokenOut) {
    throw new DexError('INVALID_PAIR', 'tokenIn and tokenOut must differ', 400);
  }
  const maxAmountIn = asNumber(input.maxAmountIn, 'maxAmountIn');
  const pools = livePools();
  const buyPool = pools.find((p) => p.poolId === String(input.buyPoolId));
  const sellPool = pools.find((p) => p.poolId === String(input.sellPoolId));
  if (!buyPool || !sellPool) throw new DexError('UNKNOWN_POOL', 'buyPoolId and sellPoolId must be active pools', 404);
  if (buyPool.poolId === sellPool.poolId) {
    throw new DexError('INVALID_POOLS', 'the buy and sell pools must differ', 400);
  }
  if (!poolSupports(buyPool, tokenIn, tokenOut) || !poolSupports(sellPool, tokenOut, tokenIn)) {
    throw new DexError('UNSUPPORTED_PAIR', 'the pools do not both serve this pair', 400);
  }

  const opportunity = findArbitrage(
    quoteThrough(buyPool, tokenIn, tokenOut),
    quoteThrough(sellPool, tokenOut, tokenIn),
    buyPool.poolId,
    sellPool.poolId,
    tokenIn,
    tokenOut,
    maxAmountIn,
  );
  if (!opportunity) throw new DexError('NO_ARBITRAGE', 'the pools offer no profitable arbitrage at this size', 409);

  return getDb().transaction(() => {
    const buy = executeSwap({ userId, tokenIn, tokenOut, amountIn: opportunity.amountIn });
    const sell = executeSwap({ userId, tokenIn: tokenOut, tokenOut: tokenIn, amountIn: buy.amountOut });
    return {
      buySwapId: buy.swapId,
      sellSwapId: sell.swapId,
      tokenIn,
      tokenOut,
      amountIn: buy.amountIn,
      amountOut: sell.amountOut,
      profit: sell.amountOut - buy.amountIn,
    };
  })() as ArbitrageResult;
}

// ============================================================================
// Liquidation
// ============================================================================

interface ScannedLiquidation extends LiquidationCandidate {
  marketId: string;
  userId: string;
  asset: string;
  collateralAsset: string | null;
  borrowed: number;
  collateral: number;
  collateralValue: number;
}

/**
 * Every liquidatable borrow on the venue, ranked by keeper profit.
 *
 * The health factor is computed the same way the position view computes it: the
 * locked collateral is valued in the borrowed asset first, and a position whose
 * collateral has no price is skipped rather than judged on its raw quantity.
 * The bounty is the liquidation bonus, valued in the borrowed asset.
 */
export function scanLiquidations(): ScannedLiquidation[] {
  const rows = getDb()
    .prepare(
      `SELECT p.position_id, p.user_id, p.borrowed, p.collateral_asset, m.market_id, m.asset, m.liquidation_threshold, m.liquidation_bonus
         FROM dex_lending_positions p JOIN dex_lending_markets m ON m.market_id = p.market_id
        WHERE p.borrowed > 0`,
    )
    .all() as Array<Record<string, unknown>>;

  const candidates: ScannedLiquidation[] = [];
  for (const row of rows) {
    const borrowed = Number(row.borrowed);
    const asset = String(row.asset);
    const collateralAsset = row.collateral_asset === null || row.collateral_asset === undefined ? null : String(row.collateral_asset);
    if (collateralAsset === null) continue;
    const collateral = lockedBalance(String(row.user_id), collateralAsset);
    const collateralPrice = priceInQuote(collateralAsset, asset);
    if (collateralPrice === null) continue;
    const collateralValue = collateral * collateralPrice;
    const health = healthFactor(collateralValue, Number(row.liquidation_threshold), borrowed);
    if (health >= 1) continue;
    const { bonusValue } = liquidate(borrowed, collateralValue, borrowed, Number(row.liquidation_bonus), 0.5);
    candidates.push({
      positionId: String(row.position_id),
      healthFactor: health,
      // The bounty is already a value in the borrowed asset, which is the unit
      // the candidate list ranks on.
      bounty: bonusValue,
      marketId: String(row.market_id),
      userId: String(row.user_id),
      asset,
      collateralAsset,
      borrowed,
      collateral,
      collateralValue,
    });
  }
  return liquidationCandidates(candidates) as ScannedLiquidation[];
}

function lockedBalance(userId: string, currency: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(b.locked), 0) AS locked FROM balances b JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ? AND b.currency = ?`,
    )
    .get(userId, currency) as { locked: number };
  return Number(row.locked) || 0;
}

/** Liquidate a liquidatable position, paying the keeper bonus. */
export function runLiquidation(liquidatorId: string, positionId: unknown, collateralAsset: unknown) {
  assertDexOpen('dex', 'dex_margin');
  assertNotBlacklisted([{ kind: 'wallet', value: liquidatorId }]);
  const id = String(positionId ?? '').trim();
  const collateral = String(collateralAsset ?? '').trim().toUpperCase();
  if (!id || !collateral) throw new DexError('INVALID_PARAMS', 'positionId and collateralAsset are required', 400);
  const position = getDb()
    .prepare('SELECT market_id FROM dex_lending_positions WHERE position_id = ?')
    .get(id) as { market_id: string } | undefined;
  if (!position) throw new DexError('NO_POSITION', 'position does not exist', 404);
  return liquidateBorrow(liquidatorId, position.market_id, id, collateral);
}

// ============================================================================
// Advisory planners (market maker, grid, rebalance, DCA)
// ============================================================================

export interface BotDecision {
  botType: BotType;
  action: string;
  detail: Record<string, unknown>;
}

/**
 * Evaluate a single bot instance against live state and return its decision.
 *
 * The market-maker quote, grid action, rebalance plan and DCA signal are all
 * derived from real pool prices; nothing is settled here, so the caller can
 * preview a strategy before it trades.
 */
export function evaluateBotInstance(instance: Record<string, unknown>): BotDecision {
  const botType = requireBotType(instance.botType);
  const params = asRecord(instance.params ?? {});
  const poolId = instance.poolId === null || instance.poolId === undefined ? null : String(instance.poolId);

  switch (botType) {
    case 'market_maker': {
      const price = poolPrice(poolId, params);
      const inventoryBase = asNumber(params.inventoryBase ?? 0, 'inventoryBase');
      const inventoryQuote = asNumber(params.inventoryQuote ?? 0, 'inventoryQuote');
      const config: MarketMakerConfig = {
        spread: asNumber(params.spread, 'spread'),
        depth: asNumber(params.depth, 'depth'),
        rebalanceThreshold: asNumber(params.rebalanceThreshold, 'rebalanceThreshold'),
      };
      const quote = marketMakerQuote(price, inventoryBase, inventoryQuote, config);
      return {
        botType,
        action: needsRebalance(inventoryBase, inventoryQuote, price, config.rebalanceThreshold) ? 'rebalance' : 'quote',
        detail: { price, ...quote },
      };
    }
    case 'grid': {
      const price = poolPrice(poolId, params);
      const config = {
        lowerPrice: asNumber(params.lowerPrice, 'lowerPrice'),
        upperPrice: asNumber(params.upperPrice, 'upperPrice'),
        levels: asNumber(params.levels, 'levels'),
        orderSize: asNumber(params.orderSize, 'orderSize'),
        spacing: params.spacing === 'geometric' ? ('geometric' as const) : ('arithmetic' as const),
      };
      const state = asRecord(instance.state ?? {});
      const previous = Number(state.lastPrice);
      if (!Number.isFinite(previous) || previous <= 0) {
        return { botType, action: 'prime', detail: { price } };
      }
      const decision = gridAction(config, previous, price);
      return { botType, action: decision.action, detail: { price, previousPrice: previous, decision } };
    }
    case 'infinity_grid': {
      const price = poolPrice(poolId, params);
      const config = {
        ratio: asNumber(params.ratio, 'ratio'),
        budget: asNumber(params.budget, 'budget'),
        depth: asNumber(params.depth, 'depth'),
      };
      const state = asRecord(instance.state ?? {});
      const previous = Number(state.lastPrice);
      const ladder = infinityGridLevels(config, price);
      if (!Number.isFinite(previous) || previous <= 0) {
        return { botType, action: 'prime', detail: { price, ladder } };
      }
      if (price === previous) return { botType, action: 'hold', detail: { price, ladder } };
      // A fall through a level buys the nearest buy level at or below the price;
      // a rise sells the nearest sell level at or above it.
      const action = price < previous ? 'buy' : 'sell';
      const side = ladder.filter((l) => l.side === action);
      const order =
        action === 'buy'
          ? side.filter((l) => l.price <= price).sort((a, b) => b.price - a.price)[0] ?? side[side.length - 1]
          : side.filter((l) => l.price >= price).sort((a, b) => a.price - b.price)[0] ?? side[0];
      return { botType, action, detail: { price, previousPrice: previous, order } };
    }
    case 'martingale': {
      const price = poolPrice(poolId, params);
      const config = {
        baseAmount: asNumber(params.baseAmount, 'baseAmount'),
        multiplier: asNumber(params.multiplier, 'multiplier'),
        maxAmount: asNumber(params.maxAmount, 'maxAmount'),
      };
      const step = Number(asRecord(instance.state ?? {}).step ?? 0);
      const amount = martingaleAmount(config, Number.isInteger(step) && step >= 0 ? step : 0);
      return { botType, action: 'buy', detail: { price, step, amount } };
    }
    case 'twap': {
      const price = poolPrice(poolId, params);
      const config = {
        totalQuantity: asNumber(params.totalQuantity, 'totalQuantity'),
        slices: asNumber(params.slices, 'slices'),
        intervalSeconds: asNumber(params.intervalSeconds, 'intervalSeconds'),
      };
      const slices = twapSlices(config);
      const next = Number(asRecord(instance.state ?? {}).nextSlice ?? 0);
      if (!Number.isInteger(next) || next < 0 || next >= slices.length) {
        return { botType, action: 'complete', detail: { price, slices: slices.length } };
      }
      return { botType, action: 'twap', detail: { price, nextSlice: next, sliceSize: slices[next], remaining: slices.length - next } };
    }
    case 'dca': {
      const price = poolPrice(poolId, params);
      const lookback = Number(params.lookback);
      const history = historyFor(poolId);
      const buy = dcaShouldBuy(history, lookback, price);
      return { botType, action: buy ? 'buy' : 'hold', detail: { price, lookback, samples: history.length } };
    }
    case 'rebalance': {
      const holdings = asRecord(instance.state ?? {}).holdings;
      const targets = params.targets;
      if (!Array.isArray(holdings) || !Array.isArray(targets)) {
        throw new DexError('INVALID_STATE', 'a rebalance bot needs holdings and targets', 400);
      }
      const trades = planRebalance(
        holdings.map((h) => {
          const record = asRecord(h);
          return { token: String(record.token ?? ''), value: asNumber(record.value, 'holdings.value') };
        }),
        targets.map((t) => {
          const record = asRecord(t);
          return { token: String(record.token ?? ''), weight: asNumber(record.weight, 'targets.weight') };
        }),
        asNumber(params.minTradeQuote ?? 0, 'minTradeQuote'),
      );
      return { botType, action: trades.length > 0 ? 'rebalance' : 'hold', detail: { trades } };
    }
    case 'arbitrage': {
      const opportunities = scanArbitrage(asNumber(params.maxAmountIn, 'maxAmountIn'));
      return { botType, action: opportunities.length > 0 ? 'arbitrage' : 'hold', detail: { opportunities } };
    }
    case 'liquidation': {
      const candidates = scanLiquidations();
      return { botType, action: candidates.length > 0 ? 'liquidate' : 'hold', detail: { candidates } };
    }
  }
}

function tokensOf(pool: Pool): string[] {
  const d = pool.definition;
  switch (d.kind) {
    case 'v2':
      return Object.keys(d.reserves);
    case 'stable':
      return d.coins;
    case 'weighted':
      return d.tokens;
    case 'v3':
      return [d.token0, d.token1];
  }
}

/** The pool's price of the pair named in the bot's parameters. */
function poolPrice(poolId: string | null, params: Record<string, unknown>): number {
  if (!poolId) throw new DexError('INVALID_PARAMS', 'this bot needs a poolId', 400);
  const tokenIn = String(params.tokenIn ?? '').trim().toUpperCase();
  const tokenOut = String(params.tokenOut ?? '').trim().toUpperCase();
  if (!tokenIn || !tokenOut) throw new DexError('INVALID_PARAMS', 'this bot needs tokenIn and tokenOut', 400);
  const pool = livePools().find((p) => p.poolId === poolId);
  if (!pool) throw new DexError('UNKNOWN_POOL', `pool ${poolId} is not active`, 404);
  const probe = 1e-9;
  // Grid levels are the quote price of the base asset: RUSD per ETH, not the
  // AMM's tokenOut-per-tokenIn ratio, which is the reciprocal.
  const hop = quotePool(pool, tokenOut, tokenIn, probe);
  if (!(hop.amountOut > 0)) throw new DexError('NO_PRICE', 'the pool cannot price this pair', 409);
  return hop.amountOut / probe;
}

/** The pool's recent settled prices, oldest first, for a DCA signal. */
function historyFor(poolId: string | null, limit = 50): number[] {
  if (!poolId) return [];
  const rows = getDb()
    .prepare(
      `SELECT amount_in, amount_out FROM dex_swaps
        WHERE pool_id = ? AND amount_in > 0 AND amount_out > 0
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(poolId, limit) as Array<{ amount_in: number; amount_out: number }>;
  // The same quote-per-base unit `poolPrice` returns, so the two are comparable.
  return rows.map((row) => row.amount_in / row.amount_out).reverse();
}

function saveState(instanceId: string, state: Record<string, unknown>): void {
  getDb()
    .prepare("UPDATE dex_bot_instances SET state = ?, updated_at = datetime('now') WHERE instance_id = ?")
    .run(JSON.stringify(state), instanceId);
}

export interface BotRunResult {
  botType: BotType;
  action: string;
  executed: boolean;
  swapId?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: number;
  amountOut?: number;
}

/**
 * Run one step of a bot instance.
 *
 * Grid and DCA instances settle a real swap when their planner signals one, and
 * the grid records the price it acted on so the next step compares against it.
 * Arbitrage and liquidation are driven by `runArbitrage` and `runLiquidation`,
 * which need an explicit opportunity rather than an instance. The market-maker
 * and rebalancing instances report their decision without settling, because a
 * market-maker quote and a rebalance plan are multi-order intents a caller
 * applies deliberately.
 */
export function runBotInstance(userId: string, instanceId: string): BotRunResult {
  assertDexOpen('dex');
  const row = getDb()
    .prepare('SELECT * FROM dex_bot_instances WHERE instance_id = ? AND user_id = ?')
    .get(instanceId, userId) as BotInstanceRow | undefined;
  if (!row) throw new DexError('UNKNOWN_INSTANCE', 'bot instance does not exist', 404);
  if (row.status !== 'active') throw new DexError('BOT_INACTIVE', `bot instance is ${row.status}`, 409);

  const params = JSON.parse(row.params) as Record<string, unknown>;
  const botType = requireBotType(row.bot_type);
  const instance = {
    instanceId: row.instance_id,
    botType,
    poolId: row.pool_id,
    params,
    state: JSON.parse(row.state) as Record<string, unknown>,
    status: row.status,
  };
  const decision = evaluateBotInstance(instance);

  const settle = (tokenIn: string, tokenOut: string, amountIn: number): BotRunResult => {
    const swap = executeSwap({ userId, tokenIn, tokenOut, amountIn });
    return {
      botType,
      action: decision.action,
      executed: true,
      swapId: swap.swapId,
      tokenIn,
      tokenOut,
      amountIn: swap.amountIn,
      amountOut: swap.amountOut,
    };
  };

  if (botType === 'grid' || botType === 'infinity_grid') {
    const price = poolPrice(row.pool_id, params);
    if (decision.action === 'prime') {
      saveState(row.instance_id, { ...instance.state, lastPrice: price });
      return { botType, action: 'prime', executed: false };
    }
    const tokenIn = String(params.tokenIn ?? '').toUpperCase();
    const tokenOut = String(params.tokenOut ?? '').toUpperCase();
    let result: BotRunResult = { botType, action: decision.action, executed: false };
    if (botType === 'grid') {
      const orderSize = asNumber(params.orderSize, 'orderSize');
      if (decision.action === 'buy') result = settle(tokenIn, tokenOut, orderSize);
      else if (decision.action === 'sell') result = settle(tokenOut, tokenIn, orderSize);
    } else {
      const order = asRecord(decision.detail.order ?? {});
      const size = Number(order.size);
      if (Number.isFinite(size) && size > 0) {
        if (decision.action === 'buy') result = settle(tokenIn, tokenOut, size);
        else if (decision.action === 'sell') result = settle(tokenOut, tokenIn, size);
      }
    }
    // The grid compares each step against the price it last acted on.
    saveState(row.instance_id, { ...instance.state, lastPrice: price });
    return result;
  }

  if (botType === 'dca') {
    if (decision.action !== 'buy') return { botType, action: decision.action, executed: false };
    const amountIn = asNumber(params.amountIn, 'amountIn');
    const tokenIn = String(params.tokenIn ?? '').toUpperCase();
    const tokenOut = String(params.tokenOut ?? '').toUpperCase();
    return settle(tokenIn, tokenOut, amountIn);
  }

  if (botType === 'martingale') {
    const step = Number(asRecord(instance.state ?? {}).step ?? 0);
    const amount = asNumber(decision.detail.amount, 'amount');
    const tokenIn = String(params.tokenIn ?? '').toUpperCase();
    const tokenOut = String(params.tokenOut ?? '').toUpperCase();
    const result = settle(tokenIn, tokenOut, amount);
    saveState(row.instance_id, { ...instance.state, step: (Number.isInteger(step) ? step : 0) + 1 });
    return result;
  }

  if (botType === 'twap') {
    if (decision.action !== 'twap') return { botType, action: decision.action, executed: false };
    const next = Number(asRecord(instance.state ?? {}).nextSlice ?? 0);
    const size = asNumber(decision.detail.sliceSize, 'sliceSize');
    const tokenIn = String(params.tokenIn ?? '').toUpperCase();
    const tokenOut = String(params.tokenOut ?? '').toUpperCase();
    const result = settle(tokenIn, tokenOut, size);
    saveState(row.instance_id, { ...instance.state, nextSlice: (Number.isInteger(next) ? next : 0) + 1 });
    return result;
  }

  return { botType, action: decision.action, executed: false };
}

