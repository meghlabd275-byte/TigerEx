import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { mirroredOrders } from '@/lib/trading/copy-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The orders the caller's copy config would mirror.
 *
 * Each row is derived from a real fill by a leader the caller follows and the
 * caller's own sizing rules, so the quantity is exactly what the copy path
 * would submit rather than a stored or estimated figure.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const orders = mirroredOrders(auth.user.userId, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, orders, data: orders }, { headers: NO_STORE });
}
