import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeFiatOrder, listFiatOrders, cancelFiatOrder, FiatError } from '@/lib/fiat/ramp';
import { getFiatProvider } from '@/lib/fiat/provider';
import { enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Start a fiat withdrawal (a fiat `sell`): give crypto, receive fiat.
 *
 * The seller's crypto is locked immediately so the same balance cannot back two
 * pending sells. The lock is consumed only when the provider's signed callback
 * confirms the fiat was paid out, and released if the order is rejected or
 * cancelled. Without a configured provider the order is refused.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'fiat.withdraw.post');
  if (guard) return guard;

  const provider = getFiatProvider();
  if (!provider) {
    return NextResponse.json(
      { success: false, error: { code: 'FIAT_UNAVAILABLE', message: 'No fiat provider is configured on this deployment' } },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } }, { status: 400 });
  }

  const fiatCurrency = String(body.fiatCurrency ?? body.currency ?? '').toUpperCase();
  const cryptoCurrency = String(body.cryptoCurrency ?? body.asset ?? '').toUpperCase();
  const fiatAmount = Number(body.fiatAmount ?? body.amount);
  const providerId = body.providerId ? String(body.providerId) : null;

  if (!fiatCurrency || !cryptoCurrency || !Number.isFinite(fiatAmount)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_PARAMS', message: 'fiatCurrency, cryptoCurrency and fiatAmount are required' } },
      { status: 400 },
    );
  }

  try {
    const order = placeFiatOrder(auth.user.userId, 'sell', fiatCurrency, cryptoCurrency, fiatAmount, providerId);
    await provider.submit({
      orderId: order.orderId,
      userId: auth.user.userId,
      direction: order.direction,
      fiatCurrency: order.fiatCurrency,
      cryptoCurrency: order.cryptoCurrency,
      fiatAmount: order.fiatAmount,
      cryptoAmount: order.cryptoAmount,
      rate: order.rate,
      fee: order.fee,
    });
    return NextResponse.json({ success: true, data: order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof FiatError) {
      return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error('Fiat withdraw error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'PROVIDER_ERROR', message: 'The fiat provider could not accept the order' } },
      { status: 502 },
    );
  }
}

/** The authenticated user's fiat withdrawal (sell) history. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = request.nextUrl;
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 100);
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

  const orders = listFiatOrders(auth.user.userId, limit, offset).filter((o) => o.direction === 'sell');
  return NextResponse.json({ success: true, data: orders }, { headers: NO_STORE });
}

/** Cancel a pending fiat withdrawal and release the locked crypto. */
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const orderId = request.nextUrl.searchParams.get('orderId');
  if (!orderId) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_PARAMS', message: 'orderId is required' } }, { status: 400 });
  }
  try {
    const order = cancelFiatOrder(orderId, auth.user.userId);
    return NextResponse.json({ success: true, data: order }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof FiatError) {
      return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
