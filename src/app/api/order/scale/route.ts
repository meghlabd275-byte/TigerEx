import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeScaleOrder, SpotError } from '@/lib/trading/spot-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Create a scale (ladder) plan: limit orders spread evenly between two prices.
 * The scheduler places each rung; each rung is a real resting spot order.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'order.place');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const plan = placeScaleOrder(auth.user.userId, {
      symbol: String(body.symbol ?? body.marketSymbol ?? '').trim().toUpperCase(),
      side: body.side === 'sell' ? 'sell' : 'buy',
      quantity: Number(body.quantity ?? body.amount),
      startPrice: Number(body.startPrice),
      endPrice: Number(body.endPrice),
      slices: Number(body.slices),
      intervalMs: body.intervalMs === undefined || body.intervalMs === null ? undefined : Number(body.intervalMs),
    });
    return NextResponse.json({ success: true, plan }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SpotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
