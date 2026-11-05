import { NextRequest } from 'next/server';
import { requireApiKey, v1Error, v1Ok } from '@/lib/api/v1-guard';
import { symbolParam } from '@/lib/api/route-guards';
import { listOpenOrders, listOrderHistory, placeSpotOrder, SpotError, type SpotOrderType } from '@/lib/trading/spot-engine';

function readRawSymbol(request: NextRequest): string | null | undefined {
  const raw = request.nextUrl.searchParams.get('symbol');
  if (raw === null) return null;
  return symbolParam(raw) ?? undefined;
}

/**
 * Open orders, or order history with `history=true`.
 *
 * Requires the `read` permission and returns only the key owner's orders.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiKey(request, 'read', '');
  if ('error' in auth) return auth.error;

  const symbol = readRawSymbol(request);
  if (symbol === undefined) return v1Error('VALIDATION_FAILED', 'symbol must look like BTC/RUSD');

  const history = request.nextUrl.searchParams.get('history') === 'true';
  if (history) {
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
    return v1Ok({ orders: listOrderHistory(auth.identity.userId, symbol, limit) });
  }
  return v1Ok({ orders: listOpenOrders(auth.identity.userId, symbol) });
}

/**
 * Place a spot order.
 *
 * Requires the `trade` permission. The body is the signed payload, so it is
 * read as text once and then parsed; matching and settlement run in the venue's
 * own engine.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const auth = await requireApiKey(request, 'trade', body);
  if ('error' in auth) return auth.error;

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(body || '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return v1Error('INVALID_BODY', 'A JSON object body is required');
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return v1Error('INVALID_BODY', 'The request body is not valid JSON');
  }

  const rawType = String(parsed.type ?? 'limit').trim().toLowerCase();
  const type = (rawType === 'stop' ? 'stop_limit' : rawType) as SpotOrderType;

  try {
    const order = placeSpotOrder(auth.identity.userId, {
      symbol: String(parsed.symbol ?? '').trim().toUpperCase(),
      side: String(parsed.side ?? '').trim().toLowerCase() as 'buy' | 'sell',
      type,
      price: parsed.price === undefined ? undefined : Number(parsed.price),
      stopPrice: parsed.stopPrice === undefined ? undefined : Number(parsed.stopPrice),
      quantity: Number(parsed.quantity),
      timeInForce: parsed.timeInForce === undefined ? undefined : (String(parsed.timeInForce).toUpperCase() as never),
      postOnly: parsed.postOnly === true,
      icebergQuantity: parsed.icebergQuantity === undefined ? undefined : Number(parsed.icebergQuantity),
    });
    return v1Ok({ order });
  } catch (error) {
    if (error instanceof SpotError) return v1Error(error.code, error.message, error.status);
    throw error;
  }
}
