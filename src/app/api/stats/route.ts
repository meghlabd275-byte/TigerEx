import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Exchange-wide statistics.
 *
 * Every figure is aggregated from TigerEx's own database. Nothing is
 * extrapolated or hardcoded: if the exchange has no trading history yet, the
 * counters are genuinely zero rather than an illustrative placeholder.
 */
export async function GET() {
  try {
    const db = getDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const pairs = db
      .prepare(`SELECT COUNT(*) AS n FROM trading_pairs WHERE status = 'active'`)
      .get() as { n: number };

    const users = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };

    const volume = db
      .prepare(
        `SELECT COALESCE(SUM(filled_quantity * COALESCE(average_price, price, 0)), 0) AS v,
                COUNT(*) AS trades
           FROM orders
          WHERE created_at >= ? AND status IN ('filled', 'partially_filled')`,
      )
      .get(since) as { v: number; trades: number };

    return NextResponse.json(
      {
        success: true,
        data: {
          dailyVolume: volume.v,
          tradingPairs: pairs.n,
          totalUsers: users.n,
          trades24h: volume.trades,
          window: '24h',
          asOf: new Date().toISOString(),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
