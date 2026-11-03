import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listOpenOrders } from '@/lib/trading/spot-engine';
import { symbolParam, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's open spot orders.
 *
 * Reads the orders this venue holds; an account with no open orders gets an
 * empty list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const raw = request.nextUrl.searchParams.get('symbol');
  const symbol = raw === null ? null : symbolParam(raw);
  const orders = listOpenOrders(auth.user.userId, symbol);

  return NextResponse.json({ success: true, orders }, { headers: NO_STORE });
}
