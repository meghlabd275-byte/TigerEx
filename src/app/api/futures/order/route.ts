import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeFuturesOrder, FuturesError, listPositions } from '@/lib/trading/futures-engine';
import { toPositionPayload } from '@/lib/trading/position-view';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Place a derivative order.
 *
 * The order either opens or increases a position, locking the margin its
 * leverage requires, or reduces and closes one, returning the margin plus the
 * realized P&L. The mark price, risk tier and fees all come from the venue's
 * own listings.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'futures.order');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const symbol = String(body.symbol ?? body.contract ?? '').trim();
  if (!symbol) return fail('VALIDATION_FAILED', 'symbol is required');

  const side = String(body.side ?? '').trim().toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return fail('VALIDATION_FAILED', 'side must be buy or sell');
  }

  const positionSide = String(body.positionSide ?? 'both').trim().toLowerCase();
  if (!['long', 'short', 'both'].includes(positionSide)) {
    return fail('VALIDATION_FAILED', 'positionSide must be long, short or both');
  }

  const type = String(body.type ?? 'limit').trim().toLowerCase();
  if (type !== 'limit' && type !== 'market') {
    return fail('VALIDATION_FAILED', 'type must be limit or market');
  }

  const marginMode = String(body.marginMode ?? 'cross').trim().toLowerCase();
  if (marginMode !== 'cross' && marginMode !== 'isolated') {
    return fail('VALIDATION_FAILED', 'marginMode must be cross or isolated');
  }

  try {
    const result = placeFuturesOrder(auth.user.userId, {
      symbol,
      side: side as 'buy' | 'sell',
      positionSide: positionSide as 'long' | 'short' | 'both',
      type: type as 'limit' | 'market',
      price: body.price === undefined ? undefined : Number(body.price),
      quantity: Number(body.quantity),
      leverage: body.leverage === undefined ? undefined : Number(body.leverage),
      marginMode: marginMode as 'cross' | 'isolated',
      reduceOnly: body.reduceOnly === true,
    });

    return NextResponse.json({ success: true, ...result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof FuturesError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

/** The caller's open positions, so a client can refresh after placing an order. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const symbol = request.nextUrl.searchParams.get('symbol');
  const positions = listPositions(auth.user.userId, symbol).map((row) =>
    toPositionPayload(row as unknown as Record<string, unknown>),
  );

  return NextResponse.json({ success: true, positions }, { headers: NO_STORE });
}
