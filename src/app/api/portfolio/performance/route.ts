import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { getDb } from '@/lib/db';
import { portfolioSummary } from '@/lib/db/portfolio';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The caller's portfolio performance.
 *
 * Realized P&L is the average-cost figure from the account's own fills;
 * unrealized P&L is the sum of the open positions' own marks. The equity curve
 * is the daily realized P&L, so a day with no closed trade is a real zero rather
 * than an interpolated point.
 */
const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const period = request.nextUrl.searchParams.get('period') ?? '30d';
  const days = PERIOD_DAYS[period] ?? 30;
  const summary = portfolioSummary(auth.user.userId);

  const db = getDb();
  const byDay = db
    .prepare(
      `SELECT date(created_at) AS day,
              COALESCE(SUM(filled_quantity * average_price), 0) AS volume,
              COUNT(*) AS trades
         FROM order_history
        WHERE user_id = ? AND status = 'filled' AND created_at >= datetime('now', ?)
        GROUP BY day`,
    )
    .all(auth.user.userId, `-${days} day`) as Array<{ day: string; volume: number; trades: number }>;

  const map = new Map(byDay.map((row) => [row.day, row]));
  const series: Array<{ day: string; volume: number; trades: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const row = map.get(day);
    series.push({ day, volume: Number(row?.volume) || 0, trades: Number(row?.trades) || 0 });
  }

  const data = {
    period,
    realizedPnl: summary.realizedPnlUSDT,
    realizedPnl24h: summary.realizedPnl24hUSDT,
    unrealizedPnl: summary.unrealizedPnlUSDT,
    totalBalanceUSDT: summary.totalBalanceUSDT,
    series,
  };

  return NextResponse.json({ success: true, performance: data, data }, { headers: NO_STORE });
}
