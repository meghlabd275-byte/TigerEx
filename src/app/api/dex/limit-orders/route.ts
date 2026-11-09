import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { getDb, generateId } from '@/lib/db';
import { validateLimitOrder } from '@/lib/dex/orders';
import { dexFailure } from '@/lib/dex/route-helpers';
import { loadPool } from '@/lib/dex/pool-service';

/**
 * On-chain limit orders.
 *
 * A limit order is a standing instruction: the caller signs it, the protocol
 * watches the pool's price and settles it when the price crosses. Creation and
 * cancellation are here; settlement is performed by the keeper loop that calls
 * `settleDueLimitOrders`.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    const orders = getDb()
      .prepare('SELECT * FROM dex_limit_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
      .all(auth.user.userId) as Array<Record<string, unknown>>;
    return NextResponse.json({ success: true, orders }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.limit.create', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    const pool = loadPool(String(body.poolId ?? ''));
    const order = validateLimitOrder({
      poolId: pool.pool_id,
      side: String(body.side ?? 'buy') as 'buy' | 'sell',
      tokenIn: String(body.tokenIn ?? ''),
      tokenOut: String(body.tokenOut ?? ''),
      amountIn: Number(body.amountIn),
      limitPrice: Number(body.limitPrice),
    });
    const orderId = generateId();
    getDb()
      .prepare(
        'INSERT INTO dex_limit_orders (order_id, pool_id, user_id, side, token_in, token_out, amount_in, limit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(orderId, order.poolId, auth.user.userId, order.side, order.tokenIn, order.tokenOut, order.amountIn, order.limitPrice);
    return NextResponse.json({ success: true, orderId }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.limit.cancel', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const orderId = String(body?.orderId ?? request.nextUrl.searchParams.get('orderId') ?? '');
  try {
    const result = getDb()
      .prepare("UPDATE dex_limit_orders SET status = 'cancelled', updated_at = datetime('now') WHERE order_id = ? AND user_id = ? AND status = 'open'")
      .run(orderId, auth.user.userId);
    if (result.changes === 0) return fail('NO_ORDER', 'no open order with that id', 404);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
