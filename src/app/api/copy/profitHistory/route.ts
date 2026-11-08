import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { profitHistory } from '@/lib/trading/copy-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's copy-trading profit history.
 *
 * The follower's profit on each of a leader's closed positions is the leader's
 * realized P&L scaled by the follower's copy ratio (bounded by their maximum),
 * and the profit share is taken only from positive profit.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const history = profitHistory(auth.user.userId, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ success: true, history, data: history }, { headers: NO_STORE });
}
