import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { advanceOrder, P2pError } from '@/lib/p2p/market';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Open a dispute on an order.
 *
 * The escrow stays locked while the dispute is open; only an operator can
 * resolve it from the admin console.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'p2p.appeal', 10, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const orderId = String(body?.orderId ?? request.nextUrl.searchParams.get('orderId') ?? '').trim();
  const reason = String(body?.reason ?? '').trim();
  if (!orderId) return fail('VALIDATION_FAILED', 'An order id is required');
  if (reason.length < 3) return fail('VALIDATION_FAILED', 'A reason is required');

  try {
    const result = advanceOrder(auth.user.userId, orderId, 'dispute', { reason });
    return NextResponse.json({ success: true, orderId, status: result.status }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof P2pError) return fail(error.code, error.message, error.status);
    console.error('P2P appeal error:', error);
    return fail('INTERNAL_ERROR', 'The dispute could not be opened', 500);
  }
}
