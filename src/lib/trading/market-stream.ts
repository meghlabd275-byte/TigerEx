/**
 * Real-time market-data stream.
 *
 * The stream is a snapshot diff, not a replay: each tick carries the current
 * order-book depth, the newest settled trades and the ticker, all read from the
 * venue's own tables. When nothing has changed since the previous tick the frame
 * is suppressed, so a quiet market does not flood the socket with identical
 * payloads.
 *
 * The frame builder is a pure function of the two snapshots, which keeps it
 * testable without a live socket: `buildStreamFrame(previous, current)` returns
 * `null` when there is nothing new to send.
 */

import { orderBookDepth, recentTrades, rolling24h, type PublicTrade } from '@/lib/trading/market-view';

export interface StreamDepthLevel {
  price: number;
  amount: number;
  total: number;
}

export interface StreamSnapshot {
  symbol: string;
  bids: StreamDepthLevel[];
  asks: StreamDepthLevel[];
  trades: PublicTrade[];
  ticker: {
    lastPrice: number | null;
    bid: number | null;
    ask: number | null;
    high: number | null;
    low: number | null;
    open: number | null;
    volume: number;
    quoteVolume: number;
    priceChangePercent: number | null;
    trades: number;
  };
}

/** Read one snapshot of a symbol's live market state. */
export function readMarketSnapshot(symbol: string, depthLimit = 20, tradeLimit = 50): StreamSnapshot {
  const book = orderBookDepth(symbol, depthLimit);
  const trades = recentTrades(symbol, tradeLimit);
  const stats = rolling24h(symbol);

  return {
    symbol: book.symbol,
    bids: book.bids.map((level) => ({ price: level.price, amount: level.quantity, total: level.total })),
    asks: book.asks.map((level) => ({ price: level.price, amount: level.quantity, total: level.total })),
    trades,
    ticker: {
      lastPrice: book.lastPrice,
      bid: book.bestBid,
      ask: book.bestAsk,
      high: stats ? stats.high : null,
      low: stats ? stats.low : null,
      open: stats ? stats.openPrice : null,
      volume: stats ? stats.volume : 0,
      quoteVolume: stats ? stats.quoteVolume : 0,
      priceChangePercent: stats ? stats.priceChangePercent : null,
      trades: stats ? stats.trades : 0,
    },
  };
}

/** Stable fingerprint of a snapshot, used to detect whether anything changed. */
export function snapshotFingerprint(snapshot: StreamSnapshot): string {
  const book = `${snapshot.bids.length}:${snapshot.asks.length}:${snapshot.bids[0]?.price ?? 0}:${snapshot.asks[0]?.price ?? 0}`;
  const lastTrade = snapshot.trades[0];
  const tape = lastTrade ? `${lastTrade.timestamp}:${lastTrade.price}:${lastTrade.quantity}:${snapshot.trades.length}` : 'none';
  return `${snapshot.symbol}|${book}|${snapshot.ticker.lastPrice ?? 0}|${snapshot.ticker.volume}|${tape}`;
}

export interface StreamFrame {
  type: 'market';
  channel: string;
  data: StreamSnapshot;
}

/**
 * Build a frame for the current snapshot, or `null` when it is unchanged.
 *
 * `previous` is the fingerprint last sent (empty on the first tick), so the
 * first snapshot is always sent and every subsequent no-op tick is dropped.
 */
export function buildStreamFrame(
  previousFingerprint: string,
  snapshot: StreamSnapshot,
): StreamFrame | null {
  const fingerprint = snapshotFingerprint(snapshot);
  if (fingerprint === previousFingerprint) return null;
  return { type: 'market', channel: `market:${snapshot.symbol}`, data: snapshot };
}
