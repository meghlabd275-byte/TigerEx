import { NextRequest, NextResponse } from 'next/server';
import { settleFiatOrder, FiatError } from '@/lib/fiat/ramp';
import { verifyFiatCallback, FIAT_SIGNATURE_HEADER } from '@/lib/fiat/provider';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Provider callback that settles a fiat order.
 *
 * The provider signs the raw request body with the shared secret, so a forged
 * callback cannot move funds. Settlement is idempotent: a replayed callback
 * (providers retry) is acknowledged as a no-op rather than crediting twice.
 *
 * Body: { orderId: string, status: 'settled' | 'rejected', reason?: string }
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();

  if (!verifyFiatCallback(raw, request.headers.get(FIAT_SIGNATURE_HEADER))) {
    return NextResponse.json(
      { success: false, error: { code: 'SIGNATURE_INVALID', message: 'The callback signature is not valid' } },
      { status: 401, headers: NO_STORE },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } }, { status: 400 });
  }

  const orderId = String(body.orderId ?? '');
  const status = String(body.status ?? '').toLowerCase();
  if (!orderId || (status !== 'settled' && status !== 'rejected')) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_PARAMS', message: 'orderId and status (settled|rejected) are required' } },
      { status: 400 },
    );
  }

  try {
    const order = settleFiatOrder(orderId, status === 'settled' ? 'settled' : 'rejected');
    return NextResponse.json({ success: true, data: order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof FiatError) {
      // A replayed callback for an already-final order is an acknowledgement,
      // not an error the provider should retry forever.
      if (error.code === 'ALREADY_FINAL') {
        return NextResponse.json({ success: true, error: { code: error.code, message: error.message } }, { headers: NO_STORE });
      }
      return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error('Fiat callback error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
