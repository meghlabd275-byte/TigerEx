import { NextRequest, NextResponse } from 'next/server';
import { traderLeaderboard } from '@/lib/leaderboard/traders';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The trader leaderboard.
 *
 * Ranked from the venue's own settled trades, closed positions and approved
 * copy leaders, so an unranked account is one with no activity rather than a
 * fabricated row. Public, like a volume board.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get('type') ?? 'traders';
  const period = params.get('period') ?? 'all';
  const limit = Number(params.get('limit') ?? 100);

  const traders = traderLeaderboard(type, period, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, traders, data: traders }, { headers: NO_STORE });
}
