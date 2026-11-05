/**
 * Trader leaderboard.
 *
 * Rankings are computed from the venue's own settled trades and closed
 * positions: volume from `spot_trades`, realized P&L from `futures_positions`,
 * and copier standing from `copy_traders`. An account with no activity is not
 * ranked at all, so the board never shows a fabricated trader or a zero that
 * looks like a real result.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  userId: string;
  username: string;
  nickname: string;
  roi: number;
  pnl: number;
  volume: number;
  trades: number;
  win_rate: number;
  followers: number;
}

/** Period keywords the board understands, mapped to a SQLite interval. */
const PERIODS: Record<string, string | null> = {
  all: null,
  '24h': '-1 day',
  '7d': '-7 day',
  '30d': '-30 day',
  '90d': '-90 day',
};

function periodClause(period: string): { clause: string; param: string | null } {
  const key = String(period ?? 'all').trim().toLowerCase();
  const interval = Object.prototype.hasOwnProperty.call(PERIODS, key) ? PERIODS[key] : PERIODS.all;
  if (interval === null) return { clause: '', param: null };
  return { clause: ' AND created_at >= datetime(\'now\', ?)', param: interval };
}

function displayName(row: Record<string, unknown>): string {
  const username = row.username === null || row.username === undefined ? '' : String(row.username);
  const display = row.display_name === null || row.display_name === undefined ? '' : String(row.display_name);
  return display || username || `trader-${String(row.user_id).slice(0, 8)}`;
}

/**
 * Rank traders by settled spot volume.
 *
 * Each user's volume is the quote amount of every trade they took either side
 * of, so a maker and a taker both receive credit for the same fill.
 */
function byVolume(period: string, limit: number): LeaderboardEntry[] {
  const { clause, param } = periodClause(period);
  const db = getDb();
  const sql = `
    SELECT u.user_id, u.username, u.display_name,
           SUM(t.quote_quantity) AS volume,
           COUNT(*) AS trades
      FROM spot_trades t
      JOIN users u ON u.user_id = t.maker_user_id OR u.user_id = t.taker_user_id
     WHERE 1 = 1${clause.replace('created_at', 't.created_at')}
     GROUP BY u.user_id
     HAVING volume > 0
     ORDER BY volume DESC
     LIMIT ?`;
  const rows = (param === null ? db.prepare(sql).all(limit) : db.prepare(sql).all(param, limit)) as Array<
    Record<string, unknown>
  >;

  return rows.map((row, index) => ({
    rank: index + 1,
    user_id: String(row.user_id),
    userId: String(row.user_id),
    username: displayName(row),
    nickname: displayName(row),
    roi: 0,
    pnl: 0,
    volume: Number(row.volume) || 0,
    trades: Number(row.trades) || 0,
    win_rate: 0,
    followers: 0,
  }));
}

/**
 * Rank traders by realized futures P&L.
 *
 * Only closed positions carry realized P&L, so the sum is over rows the
 * settlement path wrote; an account that has never closed a position is absent.
 */
function byPnl(period: string, limit: number): LeaderboardEntry[] {
  const { clause, param } = periodClause(period);
  const db = getDb();
  const sql = `
    SELECT u.user_id, u.username, u.display_name,
           SUM(p.realized_pnl) AS pnl,
           COUNT(*) AS trades,
           SUM(CASE WHEN p.realized_pnl > 0 THEN 1 ELSE 0 END) AS wins
      FROM futures_positions p
      JOIN users u ON u.user_id = p.user_id
     WHERE p.status = 'closed'${clause.replace('created_at', 'p.opened_at')}
     GROUP BY u.user_id
     HAVING trades > 0
     ORDER BY pnl DESC
     LIMIT ?`;
  const rows = (param === null ? db.prepare(sql).all(limit) : db.prepare(sql).all(param, limit)) as Array<
    Record<string, unknown>
  >;

  return rows.map((row, index) => {
    const trades = Number(row.trades) || 0;
    const wins = Number(row.wins) || 0;
    return {
      rank: index + 1,
      user_id: String(row.user_id),
      userId: String(row.user_id),
      username: displayName(row),
      nickname: displayName(row),
      roi: 0,
      pnl: Number(row.pnl) || 0,
      volume: 0,
      trades,
      win_rate: trades === 0 ? 0 : wins / trades,
      followers: 0,
    };
  });
}

/** Rank approved copy-trading leaders by their published 30-day ROI. */
function byCopiers(period: string, limit: number): LeaderboardEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.trader_id, t.display_name, t.user_id, t.roi_7d, t.roi_30d, t.roi_90d,
              t.win_rate, t.followers, t.aum
         FROM copy_traders t
        WHERE t.status = 'approved'
        ORDER BY t.roi_30d DESC, t.aum DESC
        LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  const roiKey = period === '7d' ? 'roi_7d' : period === '90d' ? 'roi_90d' : 'roi_30d';
  return rows.map((row, index) => ({
    rank: index + 1,
    user_id: String(row.user_id),
    userId: String(row.user_id),
    username: String(row.display_name),
    nickname: String(row.display_name),
    roi: Number(row[roiKey]) || 0,
    pnl: 0,
    volume: Number(row.aum) || 0,
    trades: 0,
    win_rate: Number(row.win_rate) || 0,
    followers: Number(row.followers) || 0,
  }));
}

/**
 * The ranked board for a request.
 *
 * `type` selects the metric; an unrecognised type falls back to spot volume so
 * the board is never empty for a typo. `limit` is clamped to a sane range.
 */
export function traderLeaderboard(
  type: string,
  period: string,
  limit: number,
): LeaderboardEntry[] {
  const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 100;
  const kind = String(type ?? 'traders').trim().toLowerCase();
  if (kind === 'copiers') return byCopiers(period, bounded);
  if (kind === 'pnl') return byPnl(period, bounded);
  return byVolume(period, bounded);
}
