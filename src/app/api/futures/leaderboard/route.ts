import { NextRequest, NextResponse } from 'next/server';
import { traderLeaderboard } from '@/lib/leaderboard/traders';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The futures P&L leaderboard.
 *
 * Ranked from closed positions' realized P&L, so only accounts that have
 * actually closed a position appear.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const period = params.get('period') ?? '30d';
  const limit = Number(params.get('limit') ?? 100);

  const entries = traderLeaderboard('pnl', period, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, leaderboard: entries, data: entries }, { headers: NO_STORE });
}
