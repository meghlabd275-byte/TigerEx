import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeSpotOrder, SpotError, type SpotOrderType } from '@/lib/trading/spot-engine';
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

  const symbol = String(body.symbol ?? body.marketSymbol ?? '').trim().toUpperCase();
  const side = String(body.side ?? '').trim().toLowerCase();
  const rawType = String(body.type ?? body.orderType ?? 'limit').trim().toLowerCase();
  const type = (rawType === 'stop' ? 'stop_limit' : rawType) as SpotOrderType;

  try {
    const order = placeSpotOrder(auth.user.userId, {
      symbol,
      side: side === 'sell' ? 'sell' : side === 'buy' ? 'buy' : ('' as 'buy'),
      type,
      price: body.price === undefined || body.price === null ? undefined : Number(body.price),
      stopPrice: body.stopPrice === undefined || body.stopPrice === null ? undefined : Number(body.stopPrice),
      quantity: Number(body.quantity ?? body.amount),
      timeInForce: body.timeInForce ? (String(body.timeInForce).toUpperCase() as 'GTC') : undefined,
      postOnly: body.postOnly === true,
      icebergQuantity:
        body.icebergQuantity === undefined || body.icebergQuantity === null ? undefined : Number(body.icebergQuantity),
    });

    return NextResponse.json({ success: true, order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SpotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
