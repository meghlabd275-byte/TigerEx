import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { mirroredOrders, executedCopies } from '@/lib/trading/copy-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's copy-trading orders.
 *
 * By default this previews the orders the caller's copy config would mirror
 * from their leaders' recent fills. With `?executed=true` it instead returns the
 * orders the copy sweeps have actually placed, so the two views can be compared
 * rather than conflated.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const bounded = Number.isFinite(limit) ? limit : 100;
  const executed = request.nextUrl.searchParams.get('executed') === 'true';

  const orders = executed
    ? executedCopies(auth.user.userId, bounded)
    : mirroredOrders(auth.user.userId, bounded);
  return NextResponse.json({ success: true, executed, orders, data: orders }, { headers: NO_STORE });
}
