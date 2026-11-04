import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeOrder, userOrders, P2pError } from '@/lib/p2p/market';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's P2P orders, and placing a new one.
 *
 * POST escrows the crypto side of the trade before the order is created, so a
 * trade can never be opened without the funds to settle it. GET lists the
 * caller's own orders as buyer or seller.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const orders = userOrders(auth.user.userId, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, orders, data: orders }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'p2p.orders', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const offerId = String(body.offerId ?? body.adId ?? body.id ?? '').trim();
  if (!offerId) return fail('VALIDATION_FAILED', 'An ad id is required');

  try {
    const order = placeOrder({
      buyerId: auth.user.userId,
      offerId,
      amount: Number(body.amount),
      paymentMethod: String(body.paymentMethod ?? body.method ?? ''),
    });
    return NextResponse.json({ success: true, order, data: order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof P2pError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    console.error('P2P order error:', error);
    return fail('INTERNAL_ERROR', 'The order could not be placed', 500);
  }
}
