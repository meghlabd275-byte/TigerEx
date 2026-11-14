import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeSpotOrder, SpotError } from '@/lib/trading/spot-engine';
import { parseSpotOrderBody } from '@/lib/api/order-input';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Place a spot order.
 *
 * The order is validated, funds are reserved, and the order is matched against
 * the venue's own book; a fill settles real balances. There is no backend hop:
 * this handler is the order entry point for a self-contained deployment.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'order.place');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const order = placeSpotOrder(auth.user.userId, parseSpotOrderBody(body));
    return NextResponse.json({ success: true, order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SpotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
