import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Revenue ledger.
 *
 * Every fee, interest payment, liquidation fee and spread the exchange earned is
 * a row here. Totals are grouped by category and by day so the console can show
 * real revenue without any sampling.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') ?? 30) || 30, 1), 366);
  const db = getDb();

  const byCategory = db
    .prepare('SELECT category, asset, COALESCE(SUM(amount), 0) AS amount FROM revenue_ledger GROUP BY category, asset ORDER BY amount DESC')
    .all() as Array<{ category: string; asset: string; amount: number }>;

  const byDay = db
    .prepare(
      `SELECT date(created_at) AS day, category, COALESCE(SUM(amount), 0) AS amount
         FROM revenue_ledger
        WHERE created_at >= datetime('now', ?)
        GROUP BY day, category
        ORDER BY day DESC`,
    )
    .all(`-${days} day`) as Array<{ day: string; category: string; amount: number }>;

  const total = byCategory.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  return NextResponse.json(
    {
      success: true,
      days,
      total,
      byCategory: byCategory.map((row) => ({ category: row.category, asset: row.asset, amount: Number(row.amount) || 0 })),
      byDay: byDay.map((row) => ({ day: row.day, category: row.category, amount: Number(row.amount) || 0 })),
    },
    { headers: NO_STORE },
  );
}
