import type { PlaceOrderInput, SpotOrderType } from '@/lib/trading/spot-engine';

/**
 * Parse a spot order request body into `PlaceOrderInput`.
 *
 * The `/api/order/place` and `/api/spot/order` handlers share this so an order
 * placed from either entry point is validated identically. Only the fields the
 * caller actually sent are forwarded, so an absent price stays absent rather
 * than becoming `NaN`.
 */
export function parseSpotOrderBody(body: Record<string, unknown>): PlaceOrderInput {
  const symbol = String(body.symbol ?? body.marketSymbol ?? '').trim().toUpperCase();
  const side = String(body.side ?? '').trim().toLowerCase();
  const rawType = String(body.type ?? body.orderType ?? 'limit').trim().toLowerCase();
  const type = (rawType === 'stop' ? 'stop_limit' : rawType) as SpotOrderType;

  const num = (value: unknown): number | undefined =>
    value === undefined || value === null || value === '' ? undefined : Number(value);

  return {
    symbol,
    side: side === 'sell' ? 'sell' : side === 'buy' ? 'buy' : ('' as 'buy'),
    type,
    price: num(body.price),
    stopPrice: num(body.stopPrice),
    quantity: Number(body.quantity ?? body.amount),
    timeInForce: body.timeInForce ? (String(body.timeInForce).toUpperCase() as PlaceOrderInput['timeInForce']) : undefined,
    postOnly: body.postOnly === true,
    icebergQuantity: num(body.icebergQuantity),
    trailingDistance: num(body.trailingDistance),
    trailingActivateOnProfit: body.trailingActivateOnProfit === true,
  };
}
