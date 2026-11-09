import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import {
  placeConditionalOrder,
  listConditionalOrders,
  cancelConditionalOrder,
  FuturesError,
  type ConditionalType,
} from '@/lib/trading/futures-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Conditional orders: stop-loss, take-profit and trailing stops.
 *
 * GET lists the caller's orders, POST parks a new one against an open position,
 * DELETE cancels a pending one. A conditional order is reduce-only by
 * construction — it closes the position it protects — so it can never open or
 * flip a position.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const symbol = request.nextUrl.searchParams.get('symbol');
  const orders = listConditionalOrders(auth.user.userId, symbol);

  return NextResponse.json({ success: true, orders }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'futures.conditional');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const symbol = String(body.symbol ?? '').trim();
  if (!symbol) return fail('VALIDATION_FAILED', 'symbol is required');

  const positionSide = String(body.positionSide ?? 'both').trim().toLowerCase();
  if (!['long', 'short', 'both'].includes(positionSide)) {
    return fail('VALIDATION_FAILED', 'positionSide must be long, short or both');
  }

  const type = String(body.type ?? '').trim().toLowerCase();
  if (!['stop_loss', 'take_profit', 'trailing_stop'].includes(type)) {
    return fail('VALIDATION_FAILED', 'type must be stop_loss, take_profit or trailing_stop');
  }

  try {
    const order = placeConditionalOrder(auth.user.userId, {
      symbol,
      positionSide: positionSide as 'long' | 'short' | 'both',
      type: type as ConditionalType,
      quantity: Number(body.quantity),
      stopPrice: body.stopPrice === undefined ? undefined : Number(body.stopPrice),
      callbackRate: body.callbackRate === undefined ? undefined : Number(body.callbackRate),
    });
    return NextResponse.json({ success: true, order }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof FuturesError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'futures.conditional.cancel');
  if (guard) return guard;

  const orderId = request.nextUrl.searchParams.get('orderId')?.trim() ?? '';
  if (!orderId) return fail('VALIDATION_FAILED', 'orderId is required');

  try {
    const order = cancelConditionalOrder(auth.user.userId, orderId);
    return NextResponse.json({ success: true, order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof FuturesError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
