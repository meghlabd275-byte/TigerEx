/**
 * CEX trading-bot execution.
 *
 * A bot row records a strategy and its parameters; this module is the part that
 * reads live venue state, feeds it to the same pure planner the bot was
 * validated with, and settles the decision through the spot or futures engine.
 * A bot-driven order therefore moves balances exactly as a user-driven one does,
 * and the bot never invents a fill: if the planner cannot produce a decision, or
 * the required size is not configured, the tick is skipped with a reason.
 *
 * A tick is idempotent per price level: a grid or market-maker bot only places
 * an order where it has none resting, so a scheduler running every second does
 * not stack duplicate orders on the book.
 */

import { getDb } from '@/lib/db';
import { placeSpotOrder, SpotError } from '@/lib/trading/spot-engine';
import { placeFuturesOrder, FuturesError, markPriceFor } from '@/lib/trading/futures-engine';
import { lastTradePrice, orderBookDepth } from '@/lib/trading/market-view';
import { gridLevels, dcaAmount, twapSlices, marketMakerQuotes } from '@/lib/bots/strategies';
import { pausedScope } from '@/lib/trading/controls';

export interface BotTickResult {
  botId: string;
  strategy: string;
  symbol: string;
  /** `placed` when an order was submitted, `skipped` when the tick was inert. */
  action: 'placed' | 'skipped';
  orders: Array<{ orderId: string; side: string; type: string; price: number | null; quantity: number }>;
  reason?: string;
}

export interface BotRow {
  bot_id: string;
  user_id: string;
  strategy: string;
  symbol: string;
  params: string;
  status: string;
  state: string | null;
  last_run_ns: number | null;
}

function parseObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A finite, positive number from a parameter, or null when absent/invalid. */
function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The observed price for a symbol: the book mid, else the last trade. */
function referencePrice(symbol: string): number | null {
  const depth = orderBookDepth(symbol, 1);
  if (depth.midPrice !== null && depth.midPrice > 0) return depth.midPrice;
  return lastTradePrice(symbol);
}

/** Whether the bot already has a resting order at this side and price. */
function hasRestingOrder(botId: string, symbol: string, side: string, price: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE o.bot_id = ? AND p.symbol = ? AND o.side = ? AND o.status IN ('open', 'partial', 'pending_trigger')
          AND ABS(o.price - ?) < 1e-9 LIMIT 1`,
    )
    .get(botId, symbol, side, price) as { '1': number } | undefined;
  return Boolean(row);
}

interface PlacedOrder {
  orderId: string;
  side: string;
  type: string;
  price: number | null;
  quantity: number;
}

/**
 * Run one tick for a single bot.
 *
 * Returns what the bot did; the caller records the state so a scheduled
 * strategy resumes where it left off.
 */
function tickBot(bot: BotRow, nowNs: number): BotTickResult {
  const params = parseObject(bot.params);
  const state = parseObject(bot.state);
  const base: Pick<BotTickResult, 'botId' | 'strategy' | 'symbol'> = {
    botId: bot.bot_id,
    strategy: bot.strategy,
    symbol: bot.symbol,
  };
  const orders: PlacedOrder[] = [];

  const skipped = (reason: string): BotTickResult => ({ ...base, action: 'skipped', orders, reason });

  if (pausedScope('trading', 'spot', 'futures')) return skipped('trading is paused');

  const price = referencePrice(bot.symbol);

  switch (bot.strategy) {
    case 'spot_grid':
    case 'infinity_grid':
    case 'futures_grid': {
      if (price === null) return skipped('no observable price');
      const size = positive(params.orderSize ?? params.quantity);
      if (size === null) return skipped('orderSize is not configured');
      const ladder = gridLevels({
        lowerPrice: Number(params.lowerPrice),
        upperPrice: Number(params.upperPrice),
        grids: Number(params.grids),
        geometric: params.geometric === true,
      });
      if ('error' in ladder) return skipped(ladder.error);

      // Quote the nearest level below the price as a bid and the nearest above
      // as an ask, so the bot is two-sided without flooding the book.
      const below = ladder.filter((level) => level.price < price).sort((a, b) => b.price - a.price)[0];
      const above = ladder.filter((level) => level.price > price).sort((a, b) => a.price - b.price)[0];

      for (const [side, level] of [['buy', below], ['sell', above]] as const) {
        if (!level) continue;
        if (hasRestingOrder(bot.bot_id, bot.symbol, side, level.price)) continue;
        try {
          const placed = placeSpotOrder(bot.user_id, {
            symbol: bot.symbol,
            side,
            type: 'limit',
            price: level.price,
            quantity: size,
            postOnly: true,
            botId: bot.bot_id,
          });
          orders.push({ orderId: placed.orderId, side, type: 'limit', price: level.price, quantity: size });
        } catch (error) {
          if (error instanceof SpotError) return skipped(`${side} level refused: ${error.message}`);
          throw error;
        }
      }
      return orders.length ? { ...base, action: 'placed', orders } : skipped('levels already quoted');
    }

    case 'market_maker': {
      if (price === null) return skipped('no observable price');
      const size = positive(params.orderSize ?? params.quantity);
      if (size === null) return skipped('orderSize is not configured');
      const quotes = marketMakerQuotes(price, {
        spread: Number(params.spread),
        depthPerSide: Number(params.depthPerSide),
        inventory: Number(params.inventory) || 0,
        maxInventory: Number(params.maxInventory),
      });
      if ('error' in quotes) return skipped(quotes.error);

      for (const [side, level] of [['buy', quotes.bid], ['sell', quotes.ask]] as const) {
        if (!Number.isFinite(level) || level <= 0) continue;
        if (hasRestingOrder(bot.bot_id, bot.symbol, side, level)) continue;
        try {
          const placed = placeSpotOrder(bot.user_id, {
            symbol: bot.symbol,
            side,
            type: 'limit',
            price: level,
            quantity: size,
            postOnly: true,
            botId: bot.bot_id,
          });
          orders.push({ orderId: placed.orderId, side, type: 'limit', price: level, quantity: size });
        } catch (error) {
          if (error instanceof SpotError) return skipped(`${side} quote refused: ${error.message}`);
          throw error;
        }
      }
      return orders.length ? { ...base, action: 'placed', orders } : skipped('quotes already resting');
    }

    case 'dca':
    case 'martingale': {
      if (price === null) return skipped('no observable price');
      const intervalNs = positive(params.intervalNs);
      if (intervalNs === null) return skipped('intervalNs is not configured');
      const stepIndex = Math.max(0, Math.trunc(Number(state.stepIndex) || 0));
      const amount = dcaAmount(
        {
          amount: Number(params.amount),
          intervalNs,
          multiplier: params.multiplier === undefined ? undefined : Number(params.multiplier),
          maxAmount: params.maxAmount === undefined ? undefined : Number(params.maxAmount),
        },
        stepIndex,
      );
      if (typeof amount === 'object') return skipped(amount.error);
      const lastRun = Number(state.lastRunNs) || 0;
      if (lastRun > 0 && nowNs - lastRun < intervalNs) return skipped('interval not elapsed');
      const quantity = amount / price;
      try {
        const placed = placeSpotOrder(bot.user_id, {
          symbol: bot.symbol,
          side: 'buy',
          type: 'market',
          quantity,
          botId: bot.bot_id,
        });
        orders.push({ orderId: placed.orderId, side: 'buy', type: 'market', price: null, quantity });
        recordState(bot.bot_id, { ...state, stepIndex: stepIndex + 1, lastRunNs: nowNs });
      } catch (error) {
        if (error instanceof SpotError) return skipped(`buy refused: ${error.message}`);
        throw error;
      }
      return { ...base, action: 'placed', orders };
    }

    case 'twap': {
      if (price === null) return skipped('no observable price');
      const intervalNs = positive(params.intervalNs);
      if (intervalNs === null) return skipped('intervalNs is not configured');
      const slices = twapSlices({
        totalQuantity: Number(params.totalQuantity),
        slices: Number(params.slices),
      });
      if ('error' in slices) return skipped(slices.error);
      const sliceIndex = Math.max(0, Math.trunc(Number(state.sliceIndex) || 0));
      if (sliceIndex >= slices.length) return skipped('all slices executed');
      const lastRun = Number(state.lastRunNs) || 0;
      if (lastRun > 0 && nowNs - lastRun < intervalNs) return skipped('interval not elapsed');
      const side = params.side === 'sell' ? 'sell' : 'buy';
      try {
        const placed = placeSpotOrder(bot.user_id, {
          symbol: bot.symbol,
          side,
          type: 'market',
          quantity: slices[sliceIndex],
          botId: bot.bot_id,
        });
        orders.push({ orderId: placed.orderId, side, type: 'market', price: null, quantity: slices[sliceIndex] });
        recordState(bot.bot_id, { ...state, sliceIndex: sliceIndex + 1, lastRunNs: nowNs });
      } catch (error) {
        if (error instanceof SpotError) return skipped(`slice refused: ${error.message}`);
        throw error;
      }
      return { ...base, action: 'placed', orders };
    }

    case 'arbitrage': {
      // A carry leg only settles when both venues are live; the spot leg buys
      // and the futures leg shorts the same notional, so the trade is delta
      // neutral rather than a directional bet.
      const futuresSymbol = String(params.futuresSymbol ?? '').trim().toUpperCase();
      const notional = positive(params.notional);
      if (!futuresSymbol) return skipped('futuresSymbol is not configured');
      if (notional === null) return skipped('notional is not configured');
      const spotPrice = lastTradePrice(bot.symbol);
      const futuresPrice = markPriceFor(futuresSymbol);
      if (spotPrice === null || futuresPrice === null) return skipped('a leg has no observable price');
      const feeRate = Number(params.feeRate) || 0;
      const holdDays = Number(params.holdDays) || 0;
      const fundingApr = Number(params.fundingApr) || 0;
      const edge = (futuresPrice - spotPrice) / spotPrice + fundingApr * (holdDays / 365) - feeRate;
      if (!(edge > 0)) return skipped('no positive carry');
      const lastRun = Number(state.lastRunNs) || 0;
      const intervalNs = positive(params.intervalNs) ?? 0;
      if (intervalNs > 0 && lastRun > 0 && nowNs - lastRun < intervalNs) return skipped('interval not elapsed');
      try {
        const spotLeg = placeSpotOrder(bot.user_id, {
          symbol: bot.symbol,
          side: 'buy',
          type: 'market',
          quantity: notional / spotPrice,
          botId: bot.bot_id,
        });
        orders.push({ orderId: spotLeg.orderId, side: 'buy', type: 'market', price: null, quantity: notional / spotPrice });
        const futuresLeg = placeFuturesOrder(bot.user_id, {
          symbol: futuresSymbol,
          side: 'sell',
          type: 'market',
          quantity: notional / futuresPrice,
        });
        orders.push({
          orderId: futuresLeg.position.positionId,
          side: 'sell',
          type: 'market',
          price: null,
          quantity: notional / futuresPrice,
        });
        recordState(bot.bot_id, { ...state, lastRunNs: nowNs });
      } catch (error) {
        if (error instanceof SpotError || error instanceof FuturesError) {
          return skipped(`leg refused: ${error.message}`);
        }
        throw error;
      }
      return { ...base, action: 'placed', orders };
    }

    default:
      // `rebalance` needs the caller's whole portfolio and is driven through the
      // portfolio route, not a single-symbol tick.
      return skipped(`${bot.strategy} is not a single-symbol strategy`);
  }
}

/**
 * Run one tick for a single bot and persist the realized PnL of anything it
 * placed, so the stored number is the bot's real result rather than zero.
 */
export function runBotTick(bot: BotRow, nowNs: number = Date.now() * 1e6): BotTickResult {
  const result = tickBot(bot, nowNs);
  if (result.action === 'placed') refreshPnl(bot.bot_id);
  return result;
}

function recordState(botId: string, state: Record<string, unknown>): void {
  getDb()
    .prepare("UPDATE trading_bots SET state = ?, last_run_ns = ? WHERE bot_id = ?")
    .run(JSON.stringify(state), Math.trunc(Number(state.lastRunNs) || 0), botId);
}

/**
 * The bot's realized result in quote terms.
 *
 * Sums the quote flow of every order the bot filled: sell proceeds less buy
 * cost, less the fees recorded against those orders. A bot that is flat has a
 * realized PnL equal to its profit; a bot holding inventory also carries the
 * cost of that inventory, which is the honest number to show rather than a
 * mark-to-market guess made from a price the bot did not trade at.
 */
export function botRealizedPnl(botId: string): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT o.side, o.filled_quantity, o.average_price
         FROM orders o
        WHERE o.bot_id = ? AND o.filled_quantity > 0 AND o.average_price IS NOT NULL`,
    )
    .all(botId) as Array<{ side: string; filled_quantity: number; average_price: number }>;

  let pnl = 0;
  for (const row of rows) {
    const notional = Number(row.filled_quantity) * Number(row.average_price);
    pnl += row.side === 'sell' ? notional : -notional;
  }

  const feeRow = db
    .prepare(
      `SELECT COALESCE(SUM(h.fee), 0) AS fee
         FROM order_history h JOIN orders o ON o.order_id = h.order_id
        WHERE o.bot_id = ?`,
    )
    .get(botId) as { fee: number } | undefined;
  pnl -= Number(feeRow?.fee) || 0;
  return pnl;
}

/** Persist the bot's current realized PnL so the view and admin see the real number. */
function refreshPnl(botId: string): void {
  getDb()
    .prepare("UPDATE trading_bots SET realized_pnl = ?, updated_at = datetime('now') WHERE bot_id = ?")
    .run(botRealizedPnl(botId), botId);
}

/**
 * Run one tick for every running bot and report what each did.
 *
 * A bot whose tick throws is reported with its error and left running; one bad
 * bot must not stop the sweep for the others.
 */
export function runDueBots(nowNs: number = Date.now() * 1e6): BotTickResult[] {
  const bots = getDb()
    .prepare("SELECT bot_id, user_id, strategy, symbol, params, status, state, last_run_ns FROM trading_bots WHERE status = 'running'")
    .all() as BotRow[];

  const results: BotTickResult[] = [];
  for (const bot of bots) {
    try {
      results.push(runBotTick(bot, nowNs));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'bot tick failed';
      results.push({ botId: bot.bot_id, strategy: bot.strategy, symbol: bot.symbol, action: 'skipped', orders: [], reason: message });
    }
  }
  return results;
}
