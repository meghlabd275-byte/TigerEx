/**
 * Candlestick (OHLCV) aggregation from the exchange's own settled trades.
 *
 * A candle is built by bucketing `spot_trades` rows into fixed intervals, so
 * the chart a client renders is the venue's real trading history. Nothing is
 * interpolated or seeded: a symbol with no trades in the window returns no
 * candles rather than a synthetic series, and a bucket with no trades is simply
 * absent instead of being filled with a carried-forward price.
 */

import { getDb } from '@/lib/db';

export interface Candle {
  /** Bucket start, in seconds since the epoch. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Supported intervals and their width in milliseconds. */
const INTERVALS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
};

export const SUPPORTED_INTERVALS = Object.keys(INTERVALS);

/**
 * Parse a SQLite `datetime('now')` value as UTC.
 *
 * The column stores `YYYY-MM-DD HH:MM:SS` with no zone marker. `Date.parse`
 * would read that as local time, which shifts every bucket by the server's
 * offset, so the fields are read explicitly as UTC.
 */
export function parseUtcTimestamp(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) {
    const fallback = Date.parse(value);
    return Number.isFinite(fallback) ? fallback : Number.NaN;
  }
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

/** Width of an interval in milliseconds, or null when it is not supported. */
export function intervalMs(interval: string): number | null {
  const width = INTERVALS[String(interval).trim().toLowerCase()];
  return Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * Candles for a symbol, oldest first.
 *
 * `interval` must be one of `SUPPORTED_INTERVALS`; an unknown interval is an
 * error rather than a silent fallback, so a client cannot be served a series
 * at a granularity it did not ask for.
 */
export function candlesFor(symbol: string, interval: string, limit: number): Candle[] {
  const width = intervalMs(interval);
  if (width === null) return [];

  const normalized = symbol.trim().toUpperCase();
  const count = Math.min(Math.max(Math.trunc(limit) || 100, 1), 1000);

  // Read enough trades to fill the requested buckets. The window is anchored to
  // the start of the current bucket rather than to `now`: `now` drifts toward the
  // end of the bucket, which would cut the oldest requested bucket short and drop
  // a candle near the end of a minute. One extra bucket of reach keeps the oldest
  // requested candle whole, since empty buckets between trades are not reported.
  const now = Date.now();
  const currentBucketStart = Math.floor(now / width) * width;
  const windowStartMs = currentBucketStart - width * (count + 1);
  const windowStart = new Date(windowStartMs).toISOString().slice(0, 19).replace('T', ' ');

  const rows = getDb()
    .prepare(
      `SELECT price, quantity, created_at
         FROM spot_trades
        WHERE symbol = ? AND created_at >= ?
        ORDER BY created_at ASC, trade_id ASC`,
    )
    .all(normalized, windowStart) as Array<{ price: number; quantity: number; created_at: string }>;

  const buckets = new Map<number, Candle>();
  for (const row of rows) {
    const price = Number(row.price);
    const quantity = Number(row.quantity);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(quantity) || quantity < 0) continue;

    const at = parseUtcTimestamp(row.created_at);
    if (!Number.isFinite(at)) continue;

    const start = Math.floor(at / width) * width;
    const existing = buckets.get(start);
    if (!existing) {
      buckets.set(start, {
        time: Math.floor(start / 1000),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: quantity,
      });
      continue;
    }
    if (price > existing.high) existing.high = price;
    if (price < existing.low) existing.low = price;
    existing.close = price;
    existing.volume += quantity;
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.time - b.time)
    .slice(-count);
}

/** Candles as positional arrays `[time, open, high, low, close, volume]`. */
export function candlesAsArrays(symbol: string, interval: string, limit: number): number[][] {
  return candlesFor(symbol, interval, limit).map((candle) => [
    candle.time,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]);
}
