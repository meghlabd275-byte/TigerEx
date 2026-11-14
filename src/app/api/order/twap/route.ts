import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeTwapOrder, SpotError } from '@/lib/trading/spot-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Create a TWAP plan. The total quantity is split into equal slices placed on
 * the scheduler's clock; each slice is a real spot order through the same
 * engine a manual order uses.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'order.place');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const plan = placeTwapOrder(auth.user.userId, {
      symbol: String(body.symbol ?? body.marketSymbol ?? '').trim().toUpperCase(),
      side: body.side === 'sell' ? 'sell' : 'buy',
      quantity: Number(body.quantity ?? body.amount),
      slices: Number(body.slices),
      intervalMs: Number(body.intervalMs),
      limitPrice:
        body.limitPrice === undefined || body.limitPrice === null || body.limitPrice === ''
          ? undefined
          : Number(body.limitPrice),
    });
    return NextResponse.json({ success: true, plan }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SpotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
