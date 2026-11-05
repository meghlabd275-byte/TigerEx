import { NextRequest } from 'next/server';
import { requireApiKey, v1Error, v1Ok } from '@/lib/api/v1-guard';
import { placeSpotOrder, SpotError, type SpotOrderType } from '@/lib/trading/spot-engine';

/**
 * Place a spot order at `/api/v1/order`.
 *
 * Requires the `trade` permission. The signed payload is the raw body, so it is
 * read once as text and parsed here.
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
