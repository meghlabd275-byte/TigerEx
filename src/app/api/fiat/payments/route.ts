import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listFiatOrders } from '@/lib/fiat/ramp';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The authenticated user's full fiat payment history (buys and sells), newest
 * first, read from this venue's own `fiat_orders` table.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = request.nextUrl;
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 100);
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

  const orders = listFiatOrders(auth.user.userId, limit, offset);
  return NextResponse.json({ success: true, data: orders }, { headers: NO_STORE });
}
