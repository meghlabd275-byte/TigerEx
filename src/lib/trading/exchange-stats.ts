/**
 * Exchange-wide statistics.
 *
 * Every figure is aggregated from TigerEx's own database. Nothing is
 * extrapolated or hardcoded: an exchange with no trading history reports
 * genuinely zero counters.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 * Timestamps are compared with SQLite's `datetime()`, because a row's
 * `created_at` is stored as `YYYY-MM-DD HH:MM:SS` while the window bound is an
 * ISO-8601 string; comparing the two as text silently drops every row.
 */

import { getDb } from '@/lib/db';

export interface ExchangeStats {
  dailyVolume: number;
  tradingPairs: number;
  totalUsers: number;
  trades24h: number;
  window: '24h';
  asOf: string;
}

/** Settled volume and trade count over the last 24 hours, from real orders. */
export function exchangeStats(nowMs = Date.now()): ExchangeStats {
  const db = getDb();
  const since = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  const pairs = db
    .prepare(`SELECT COUNT(*) AS n FROM trading_pairs WHERE status = 'active'`)
    .get() as { n: number };

  const users = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };

  const volume = db
    .prepare(
      `SELECT COALESCE(SUM(filled_quantity * COALESCE(average_price, price, 0)), 0) AS v,
              COUNT(*) AS trades
         FROM orders
        WHERE datetime(created_at) >= datetime(?) AND status IN ('filled', 'partially_filled')`,
    )
    .get(since) as { v: number; trades: number };

  return {
    dailyVolume: Number(volume.v) || 0,
    tradingPairs: Number(pairs.n) || 0,
    totalUsers: Number(users.n) || 0,
    trades24h: Number(volume.trades) || 0,
    window: '24h',
    asOf: new Date(nowMs).toISOString(),
  };
}
