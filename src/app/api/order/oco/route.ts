import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeOcoOrder, SpotError } from '@/lib/trading/spot-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Place a one-cancels-other (OCO) bracket.
 *
 * The take-profit leg rests on the book and holds the reservation; the stop leg
 * parks until the market moves against it. When either fills, the other is
 * cancelled. Both legs are validated against the venue's own last price, so a
 * bracket that is not actually two-sided is refused.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'order.place');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const num = (value: unknown): number | undefined =>
    value === undefined || value === null || value === '' ? undefined : Number(value);

  try {
    const result = placeOcoOrder(auth.user.userId, {
      symbol: String(body.symbol ?? body.marketSymbol ?? '').trim().toUpperCase(),
      side: body.side === 'sell' ? 'sell' : 'buy',
      quantity: Number(body.quantity ?? body.amount),
      stopPrice: Number(body.stopPrice),
      stopLimitPrice: num(body.stopLimitPrice),
      takeProfitPrice: Number(body.takeProfitPrice ?? body.price),
      takeProfitLimitPrice: num(body.takeProfitLimitPrice),
      timeInForce: body.timeInForce ? (String(body.timeInForce).toUpperCase() as 'GTC') : undefined,
    });
    return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SpotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
