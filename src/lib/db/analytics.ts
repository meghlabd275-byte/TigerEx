/**
 * Exchange-wide analytics computed from the durable ledger.
 *
 * Every figure is a query over rows the exchange wrote itself: `users` for
 * growth, `orders`/`order_history` for volume and order flow, `withdrawals` and
 * `deposits` for pending queues, `trading_pairs`/`futures_markets` for listings.
 * Nothing is sampled, extrapolated or defaulted; an empty ledger reports zero.
 */

import { getDb } from '@/lib/db';

export interface ExchangeStats {
  totalUsers: number;
  activeUsers24h: number;
  kycLevel1Plus: number;
  openOrders: number;
  orders24h: number;
  pendingWithdrawals: number;
  pendingDeposits: number;
  activeMarkets: number;
  totalVolume24h: number;
  futuresMarkets: number;
  optionsMarkets: number;
  etfMarkets: number;
  tradfiMarkets: number;
  p2pOrders24h: number;
  payVolume24h: number;
}

function scalar(sql: string, ...params: unknown[]): number {
  const row = getDb().prepare(sql).get(...params) as { v: number | null } | undefined;
  return row && Number.isFinite(row.v) ? Number(row.v) : 0;
}

/**
 * Aggregate the exchange's headline counters.
 *
 * The 24-hour windows are computed from timestamps the ledger records; a row
 * with an unparseable timestamp is excluded rather than counted in every window.
 */
export function exchangeStats(): ExchangeStats {
  const dayAgo = "datetime('now', '-1 day')";
  return {
    totalUsers: scalar('SELECT COUNT(*) AS v FROM users'),
    activeUsers24h: scalar(`SELECT COUNT(*) AS v FROM sessions WHERE last_active_at >= ${dayAgo}`),
    kycLevel1Plus: scalar("SELECT COUNT(*) AS v FROM users WHERE kyc_level NOT IN ('none', '0', '') AND kyc_status = 'approved'"),
    openOrders: scalar("SELECT COUNT(*) AS v FROM orders WHERE status IN ('pending', 'open', 'partially_filled')"),
    orders24h: scalar(`SELECT COUNT(*) AS v FROM orders WHERE created_at >= ${dayAgo}`),
    pendingWithdrawals: scalar("SELECT COUNT(*) AS v FROM withdrawals WHERE status = 'pending'"),
    pendingDeposits: scalar("SELECT COUNT(*) AS v FROM deposits WHERE status = 'pending'"),
    activeMarkets: scalar("SELECT COUNT(*) AS v FROM trading_pairs WHERE status = 'active'"),
    totalVolume24h: scalar(`SELECT COALESCE(SUM(filled_quantity * average_price), 0) AS v FROM order_history WHERE created_at >= ${dayAgo} AND status = 'filled'`),
    futuresMarkets: scalar('SELECT COUNT(*) AS v FROM futures_markets'),
    optionsMarkets: scalar('SELECT COUNT(*) AS v FROM options_markets'),
    etfMarkets: scalar('SELECT COUNT(*) AS v FROM etf_markets'),
    tradfiMarkets: scalar('SELECT COUNT(*) AS v FROM tradfi_markets'),
    p2pOrders24h: scalar(`SELECT COUNT(*) AS v FROM p2p_orders WHERE created_at >= ${dayAgo}`),
    payVolume24h: scalar(`SELECT COALESCE(SUM(amount), 0) AS v FROM pay_transfers WHERE created_at >= ${dayAgo}`),
  };
}

export interface DailyPoint {
  day: string;
  users: number;
  orders: number;
  volume: number;
  revenue: number;
}

/**
 * Build a daily series for the requested window.
 *
 * Days with no activity are emitted as zero so the series is continuous and a
 * chart cannot imply activity that did not happen. `days` is clamped to a
 * sane range so a caller cannot request an unbounded scan.
 */
export function dailySeries(days: number): DailyPoint[] {
  const bounded = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 366) : 30;
  const db = getDb();

  const usersByDay = rowsByDay(
    db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS n FROM users WHERE created_at >= datetime('now', ?) GROUP BY day`).all(`-${bounded} day`) as Array<{ day: string; n: number }>,
  );
  const ordersByDay = rowsByDay(
    db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS n FROM orders WHERE created_at >= datetime('now', ?) GROUP BY day`).all(`-${bounded} day`) as Array<{ day: string; n: number }>,
  );
  const volumeByDay = rowsByDay(
    db.prepare(
      `SELECT date(created_at) AS day, COALESCE(SUM(filled_quantity * average_price), 0) AS n
         FROM order_history
        WHERE created_at >= datetime('now', ?) AND status = 'filled'
        GROUP BY day`,
    ).all(`-${bounded} day`) as Array<{ day: string; n: number }>,
  );
  const revenueByDay = rowsByDay(
    db.prepare(`SELECT date(created_at) AS day, COALESCE(SUM(amount), 0) AS n FROM revenue_ledger WHERE created_at >= datetime('now', ?) GROUP BY day`).all(`-${bounded} day`) as Array<{ day: string; n: number }>,
  );

  const series: DailyPoint[] = [];
  for (let i = bounded - 1; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    series.push({
      day,
      users: usersByDay.get(day) ?? 0,
      orders: ordersByDay.get(day) ?? 0,
      volume: volumeByDay.get(day) ?? 0,
      revenue: revenueByDay.get(day) ?? 0,
    });
  }
  return series;
}

function rowsByDay(rows: Array<{ day: string | null; n: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.day) map.set(row.day, Number(row.n) || 0);
  }
  return map;
}

export interface RevenueBreakdown {
  category: string;
  amount: number;
}

/** Total revenue per category, highest first. */
export function revenueByCategory(): RevenueBreakdown[] {
  const rows = getDb()
    .prepare('SELECT category, COALESCE(SUM(amount), 0) AS amount FROM revenue_ledger GROUP BY category ORDER BY amount DESC')
    .all() as Array<{ category: string; amount: number }>;
  return rows.map((row) => ({ category: row.category, amount: Number(row.amount) || 0 }));
}
