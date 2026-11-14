import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { openPosition, closePosition, reducePosition, perpPositions, markPrice, listConditionalOrders } from '@/lib/dex/perps-service';
import { dexFailure } from '@/lib/dex/route-helpers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap perpetuals.
 *
 * `GET` lists the listed markets and the caller's open positions; `POST` opens a
 * position; `DELETE` closes one. Margin is held as a ledger reservation and PnL
 * is settled in the market's settlement asset.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    const markets = getDb()
      .prepare("SELECT symbol, base_asset, quote_asset, settlement_asset, contract_type, max_leverage, taker_fee_bps, maintenance_margin_rate, status FROM futures_markets WHERE status = 'active' ORDER BY symbol")
      .all() as Array<Record<string, unknown>>;
    const priced = markets.map((market) => {
      let price: number | null = null;
      try {
        price = markPrice(String(market.symbol));
      } catch {
        price = null;
      }
      return { ...market, markPrice: price };
    });
    return NextResponse.json({ success: true, markets: priced, positions: perpPositions(auth.user.userId), conditionalOrders: listConditionalOrders(auth.user.userId) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.perp.open', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    const position = openPosition({
      userId: auth.user.userId,
      symbol: String(body.symbol ?? ''),
      side: String(body.side ?? 'long') as 'long' | 'short',
      size: Number(body.size),
      leverage: Number(body.leverage),
      marginMode: body.marginMode === 'cross' ? 'cross' : 'isolated',
    });
    return NextResponse.json({ success: true, position }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.perp.close', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const positionId = String(body?.positionId ?? request.nextUrl.searchParams.get('positionId') ?? '');
  try {
    return NextResponse.json({ success: true, closed: closePosition(auth.user.userId, positionId) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

/**
 * Reduce an open position by a partial quantity.
 *
 * A reduce-only path: the closed fraction returns its pro-rata margin and the
 * position keeps its entry price, so a trader can cut risk without closing the
 * whole position. A quantity equal to the position size closes it.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.perp.reduce', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  const positionId = String(body.positionId ?? '');
  if (!positionId) return fail('VALIDATION_FAILED', 'positionId is required');
  try {
    return NextResponse.json(
      { success: true, reduced: reducePosition(auth.user.userId, positionId, Number(body.quantity)) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}
