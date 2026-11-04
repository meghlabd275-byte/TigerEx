import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userOrders } from '@/lib/p2p/market';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's P2P trade history.
 *
 * This is the same set of orders as `/api/p2p/orders`, presented under the
 * `trades` key that the history view reads.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const trades = userOrders(auth.user.userId, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, trades, orders: trades, data: trades }, { headers: NO_STORE });
}
