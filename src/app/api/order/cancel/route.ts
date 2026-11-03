import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { cancelSpotOrder, SpotError } from '@/lib/trading/spot-engine';
import { fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Cancel a resting spot order.
 *
 * The order's own reservation is released back to available; a partially filled
 * order releases only the remainder.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'order.cancel');
  if (guard) return guard;

  const orderId = request.nextUrl.searchParams.get('orderId')?.trim();
  if (!orderId) return fail('VALIDATION_FAILED', 'orderId query parameter is required');

  try {
    const order = cancelSpotOrder(auth.user.userId, orderId);
    return NextResponse.json({ success: true, order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SpotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'order.cancel');
  if (guard) return guard;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const orderId = String(body.orderId ?? request.nextUrl.searchParams.get('orderId') ?? '').trim();
  if (!orderId) return fail('VALIDATION_FAILED', 'orderId is required');

  try {
    const order = cancelSpotOrder(auth.user.userId, orderId);
    return NextResponse.json({ success: true, order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SpotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
