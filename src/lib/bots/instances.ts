/**
 * A user's own trading-bot instances.
 *
 * A bot is a row in `trading_bots` that carries the strategy and its
 * parameters. Creation validates the parameters with the same pure functions
 * the bot engine runs with, so a bot cannot be stored with an inverted grid
 * range or a zero DCA amount that would only fail later.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { gridLevels, dcaAmount, twapSlices, marketMakerQuotes, type GridConfig, type DcaConfig, type TwapConfig, type MarketMakerConfig } from '@/lib/bots/strategies';

export class BotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** The strategies a client may start, and the validator for each. */
const STRATEGIES = new Set([
  'spot_grid',
  'futures_grid',
  'dca',
  'martingale',
  'infinity_grid',
  'rebalance',
  'twap',
  'market_maker',
  'arbitrage',
]);

export interface BotView {
  id: string;
  bot_id: string;
  userId: string;
  strategy: string;
  type: string;
  symbol: string;
  pair: string;
  params: Record<string, unknown>;
  config: Record<string, unknown>;
  status: string;
  realizedPnl: number;
  pnl: number;
  profit: number;
  createdAt: string;
  created_at: string;
}

function toView(row: Record<string, unknown>): BotView {
  let params: Record<string, unknown> = {};
  const raw = row.params;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
    } catch {
      params = {};
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    params = raw as Record<string, unknown>;
  }

  const pnl = Number(row.realized_pnl) || 0;
  return {
    id: String(row.bot_id),
    bot_id: String(row.bot_id),
    userId: String(row.user_id),
    strategy: String(row.strategy),
    type: String(row.strategy),
    symbol: String(row.symbol),
    pair: String(row.symbol),
    params,
    config: params,
    status: String(row.status),
    realizedPnl: pnl,
    pnl,
    profit: pnl,
    createdAt: String(row.created_at),
    created_at: String(row.created_at),
  };
}

/**
 * Check a strategy's parameters with its own pure planner.
 *
 * A plan that reports an error is refused here, so the stored row is always one
 * the engine can run. Strategies without a planner only need a symbol.
 */
function validateParams(strategy: string, params: Record<string, unknown>): void {
  const numeric = (key: string): number => Number(params[key]);
  switch (strategy) {
    case 'spot_grid':
    case 'futures_grid':
    case 'infinity_grid': {
      const plan = gridLevels({
        lowerPrice: numeric('lowerPrice'),
        upperPrice: numeric('upperPrice'),
        grids: numeric('grids'),
        geometric: params.geometric === true,
      });
      if ('error' in plan) throw new BotError('INVALID_PARAMS', plan.error);
      break;
    }
    case 'dca':
    case 'martingale': {
      const plan = dcaAmount(
        { amount: numeric('amount'), intervalNs: numeric('intervalNs'), multiplier: numeric('multiplier') || undefined },
        0,
      );
      if (typeof plan === 'object') throw new BotError('INVALID_PARAMS', plan.error);
      break;
    }
    case 'twap': {
      const plan = twapSlices({
        totalQuantity: numeric('totalQuantity'),
        slices: numeric('slices'),
        intervalNs: numeric('intervalNs'),
      } as TwapConfig);
      if ('error' in plan) throw new BotError('INVALID_PARAMS', plan.error);
      break;
    }
    case 'market_maker': {
      const config: MarketMakerConfig = {
        spread: numeric('spread'),
        depthPerSide: numeric('depthPerSide'),
        inventory: numeric('inventory') || 0,
        maxInventory: numeric('maxInventory'),
      };
      const plan = marketMakerQuotes(numeric('midPrice'), config);
      if ('error' in plan) throw new BotError('INVALID_PARAMS', plan.error);
      break;
    }
    default:
      // rebalance, arbitrage: the engine validates these against live balances.
      break;
  }
}

/** The caller's own bots, newest first. */
export function listUserBots(userId: string): BotView[] {
  const rows = getDb()
    .prepare('SELECT * FROM trading_bots WHERE user_id = ? ORDER BY created_at DESC LIMIT 500')
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map(toView);
}

/** Create a bot for the caller, refusing parameters the engine cannot run. */
export function createBot(
  userId: string,
  input: { strategy: string; symbol: string; params?: Record<string, unknown>; status?: string },
): BotView {
  const strategy = String(input.strategy ?? '').trim().toLowerCase();
  if (!STRATEGIES.has(strategy)) {
    throw new BotError('VALIDATION_FAILED', `strategy must be one of ${[...STRATEGIES].join(', ')}`);
  }

  const symbol = String(input.symbol ?? '').trim().toUpperCase();
  if (!symbol) throw new BotError('VALIDATION_FAILED', 'symbol is required');

  const db = getDb();
  const market = db
    .prepare("SELECT symbol FROM trading_pairs WHERE symbol = ? AND status = 'active'")
    .get(symbol) as { symbol: string } | undefined;
  if (!market) throw new BotError('UNKNOWN_MARKET', `${symbol} is not an active spot market`, 404);

  const params = input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? input.params : {};
  validateParams(strategy, params);

  const status = input.status === 'running' ? 'running' : 'stopped';
  const botId = generateId();
  db.prepare(
    `INSERT INTO trading_bots (bot_id, user_id, strategy, symbol, params, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(botId, userId, strategy, symbol, JSON.stringify(params), status);

  const row = db.prepare('SELECT * FROM trading_bots WHERE bot_id = ?').get(botId) as Record<string, unknown>;
  return toView(row);
}

/** Start, pause or stop one of the caller's bots. */
export function setBotStatus(userId: string, botId: string, status: string): BotView {
  const id = String(botId ?? '').trim();
  if (!id) throw new BotError('VALIDATION_FAILED', 'botId is required');
  const next = String(status ?? '').trim().toLowerCase();
  if (!['running', 'paused', 'stopped'].includes(next)) {
    throw new BotError('VALIDATION_FAILED', 'status must be running, paused or stopped');
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT status FROM trading_bots WHERE bot_id = ? AND user_id = ?')
    .get(id, userId) as { status: string } | undefined;
  if (!existing) throw new BotError('UNKNOWN_BOT', 'No such bot for this account', 404);

  db.prepare("UPDATE trading_bots SET status = ?, updated_at = datetime('now') WHERE bot_id = ?").run(next, id);
  const row = db.prepare('SELECT * FROM trading_bots WHERE bot_id = ?').get(id) as Record<string, unknown>;
  return toView(row);
}
