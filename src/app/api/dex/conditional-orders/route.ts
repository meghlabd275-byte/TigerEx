import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import {
  placeConditionalOrder,
  listConditionalOrders,
  cancelConditionalOrder,
} from '@/lib/dex/perps-service';
import { CONDITIONAL_TYPES, type ConditionalType } from '@/lib/dex/conditional';
import { dexFailure } from '@/lib/dex/route-helpers';

/**
 * TigerSwap perpetual conditional orders.
 *
 * A stop-loss, take-profit or trailing stop protects an open position and is
 * fired by the keeper loop that calls `triggerConditionalOrders`. Creation,
 * listing and cancellation are here; settlement is never client-driven.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(
      { success: true, orders: listConditionalOrders(auth.user.userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.perp.conditional', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  const type = String(body.type ?? '');
  if (!(CONDITIONAL_TYPES as readonly string[]).includes(type)) {
    return fail('INVALID_TYPE', `type must be one of ${CONDITIONAL_TYPES.join(', ')}`);
  }
  try {
    const order = placeConditionalOrder({
      userId: auth.user.userId,
      positionId: String(body.positionId ?? ''),
      type: type as ConditionalType,
      quantity: Number(body.quantity),
      stopPrice: body.stopPrice === undefined ? undefined : Number(body.stopPrice),
      callbackRate: body.callbackRate === undefined ? undefined : Number(body.callbackRate),
    });
    return NextResponse.json({ success: true, order }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.perp.conditional.cancel', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const orderId = String(body?.orderId ?? request.nextUrl.searchParams.get('orderId') ?? '');
  try {
    return NextResponse.json(
      { success: true, order: cancelConditionalOrder(auth.user.userId, orderId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}
