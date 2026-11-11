/**
 * Public market views built from the durable order book.
 *
 * These functions read the exchange's own open orders and settled trades, so
 * the depth, the recent-trades tape and the last price a client sees are the
 * same data the matching path writes. Nothing is synthesised: an empty book
 * returns empty levels and a null last price rather than a placeholder.
 */

import { getDb } from '@/lib/db';
import { parseUtcTimestamp } from '@/lib/trading/candles';

export interface DepthLevel {
  price: number;
  quantity: number;
  total: number;
}

export interface BookDepth {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  lastPrice: number | null;
}

/**
 * Aggregate open orders into price levels.
 *
 * Bids are returned highest first and asks lowest first, each with a running
 * cumulative total so a client can render a depth chart without re-summing.
 */
export function orderBookDepth(symbol: string, levels: number): BookDepth {
  const db = getDb();
  const normalized = symbol.trim().toUpperCase();
  const limit = Math.min(Math.max(Math.trunc(levels) || 20, 1), 200);

  const rows = db
    .prepare(
      `SELECT o.side, o.price,
              SUM(
                CASE WHEN o.iceberg_quantity IS NOT NULL AND o.iceberg_quantity > 0
                     THEN MAX(0, o.remaining_quantity - COALESCE(o.hidden_quantity, 0))
                     ELSE o.remaining_quantity END
              ) AS quantity
         FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE p.symbol = ? AND o.status IN ('open', 'partial')
          AND o.price IS NOT NULL AND o.remaining_quantity > 0
        GROUP BY o.side, o.price`,
    )
    .all(normalized) as Array<{ side: string; price: number; quantity: number }>;

  const bids = rows
    .filter((row) => row.side === 'buy')
    .sort((a, b) => b.price - a.price)
    .slice(0, limit);
  const asks = rows
    .filter((row) => row.side === 'sell')
    .sort((a, b) => a.price - b.price)
    .slice(0, limit);

  const toLevels = (source: typeof bids): DepthLevel[] => {
    let running = 0;
    return source.map((row) => {
      const quantity = Number(row.quantity) || 0;
      running += quantity;
      return { price: Number(row.price), quantity, total: running };
    });
  };

  const bidLevels = toLevels(bids);
  const askLevels = toLevels(asks);
  const bestBid = bidLevels.length ? bidLevels[0].price : null;
  const bestAsk = askLevels.length ? askLevels[0].price : null;

  return {
    symbol: normalized,
    bids: bidLevels,
    asks: askLevels,
    bestBid,
    bestAsk,
    midPrice: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
    lastPrice: lastTradePrice(normalized),
  };
}

/** Most recent settled trade price for a symbol, or null when none exists. */
export function lastTradePrice(symbol: string): number | null {
  const row = getDb()
    .prepare('SELECT price FROM spot_trades WHERE symbol = ? ORDER BY created_at DESC LIMIT 1')
    .get(symbol) as { price: number } | undefined;
  const price = Number(row?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * The exchange's listed markets with their live 24-hour statistics.
 *
 * Every field comes from the venue's own rows: `trading_pairs` for the listing
 * metadata and settled trades for the price and volume. A market with no trades
 * in the window reports a null price and a zero volume rather than a seeded
 * quote, so a client can tell "not trading yet" from a real number.
 */
export function listedMarkets(): Array<{
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  status: string;
  tickSize: number | null;
  minQuantity: number | null;
  minNotional: number | null;
  makerFee: number | null;
  takerFee: number | null;
  lastPrice: number | null;
  volume24h: number;
  quoteVolume24h: number;
  priceChangePercent24h: number | null;
  trades24h: number;
}> {
  const rows = getDb()
    .prepare(
      `SELECT pair_id, symbol, base_currency, quote_currency, status, tick_size,
              min_quantity, min_notional, maker_fee, taker_fee
         FROM trading_pairs
        WHERE status = 'active'
        ORDER BY symbol`,
    )
    .all() as Array<{
    pair_id: string;
    symbol: string;
    base_currency: string;
    quote_currency: string;
    status: string;
    tick_size: number | null;
    min_quantity: number | null;
    min_notional: number | null;
    maker_fee: number | null;
    taker_fee: number | null;
  }>;

  return rows.map((row) => {
    const stats = rolling24h(row.symbol);
    return {
      symbol: row.symbol,
      baseCurrency: row.base_currency,
      quoteCurrency: row.quote_currency,
      status: row.status,
      tickSize: row.tick_size === null ? null : Number(row.tick_size),
      minQuantity: row.min_quantity === null ? null : Number(row.min_quantity),
      minNotional: row.min_notional === null ? null : Number(row.min_notional),
      makerFee: row.maker_fee === null ? null : Number(row.maker_fee),
      takerFee: row.taker_fee === null ? null : Number(row.taker_fee),
      lastPrice: stats ? stats.lastPrice : null,
      volume24h: stats ? stats.volume : 0,
      quoteVolume24h: stats ? stats.quoteVolume : 0,
      priceChangePercent24h: stats ? stats.priceChangePercent : null,
      trades24h: stats ? stats.trades : 0,
    };
  });
}

export interface PublicTrade {
  price: number;
  quantity: number;
  quoteQuantity: number;
  side: string;
  timestamp: number;
}

/** Recent settled trades for a symbol, newest first. */
export function recentTrades(symbol: string, limit: number): PublicTrade[] {
  const rows = getDb()
    .prepare('SELECT price, quantity, quote_quantity, side, created_at FROM spot_trades WHERE symbol = ? ORDER BY created_at DESC LIMIT ?')
    .all(symbol.trim().toUpperCase(), Math.min(Math.max(Math.trunc(limit) || 50, 1), 500)) as Array<{
    price: number;
    quantity: number;
    quote_quantity: number;
    side: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    price: Number(row.price),
    quantity: Number(row.quantity),
    quoteQuantity: Number(row.quote_quantity),
    side: row.side,
    timestamp: parseUtcTimestamp(row.created_at),
  }));
}

/**
 * 24-hour statistics for a symbol, computed from settled trades.
 *
 * Returns null when the symbol has no trades in the window, so the caller can
 * distinguish "no trading yet" from a real zero.
 */
export function rolling24h(symbol: string): {
  lastPrice: number;
  openPrice: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  priceChange: number;
  priceChangePercent: number;
  trades: number;
} | null {
  const normalized = symbol.trim().toUpperCase();
  const rows = getDb()
    .prepare(
      `SELECT price, quantity, quote_quantity, created_at
         FROM spot_trades
        WHERE symbol = ? AND created_at >= datetime('now', '-24 hour')
        ORDER BY created_at ASC`,
    )
    .all(normalized) as Array<{ price: number; quantity: number; quote_quantity: number; created_at: string }>;

  if (rows.length === 0) return null;

  const first = Number(rows[0].price);
  const last = Number(rows[rows.length - 1].price);
  let high = first;
  let low = first;
  let volume = 0;
  let quoteVolume = 0;

  for (const row of rows) {
    const price = Number(row.price);
    if (price > high) high = price;
    if (price < low) low = price;
    volume += Number(row.quantity) || 0;
    quoteVolume += Number(row.quote_quantity) || 0;
  }

  return {
    lastPrice: last,
    openPrice: first,
    high,
    low,
    volume,
    quoteVolume,
    priceChange: last - first,
    priceChangePercent: first > 0 ? ((last - first) / first) * 100 : 0,
    trades: rows.length,
  };
}
