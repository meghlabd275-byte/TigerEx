import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { advanceOrder, P2pError } from '@/lib/p2p/market';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Mark the fiat payment as sent.
 *
 * This is the buyer's step; it moves the order to `paid` so the seller can
 * release the escrow. It does not move any funds by itself.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'p2p.complete', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const orderId = String(body?.orderId ?? request.nextUrl.searchParams.get('orderId') ?? '').trim();
  if (!orderId) return fail('VALIDATION_FAILED', 'An order id is required');

  try {
    const result = advanceOrder(auth.user.userId, orderId, 'pay');
    return NextResponse.json({ success: true, orderId, status: result.status }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof P2pError) return fail(error.code, error.message, error.status);
    console.error('P2P complete error:', error);
    return fail('INTERNAL_ERROR', 'The order could not be updated', 500);
  }
}
