import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { getOrder } from '@/lib/trading/spot-engine';
import { fail, NO_STORE } from '@/lib/api/route-guards';

/** Fetch one of the caller's own orders by id. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const orderId = request.nextUrl.searchParams.get('orderId')?.trim();
  if (!orderId) return fail('VALIDATION_FAILED', 'orderId query parameter is required');

  const order = getOrder(auth.user.userId, orderId);
  if (!order) return fail('UNKNOWN_ORDER', 'No such order', 404);

  return NextResponse.json({ success: true, order }, { headers: NO_STORE });
}
