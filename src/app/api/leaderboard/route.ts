import { NextRequest, NextResponse } from 'next/server';
import { traderLeaderboard } from '@/lib/leaderboard/traders';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The exchange leaderboard.
 *
 * `type` selects the metric (`volume`, `pnl`, `copiers`); the underlying rows
 * are the venue's own trades and positions.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get('type') ?? 'volume';
  const period = params.get('period') ?? 'all';
  const limit = Number(params.get('limit') ?? 100);

  const entries = traderLeaderboard(type, period, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, leaderboard: entries, data: entries }, { headers: NO_STORE });
}
