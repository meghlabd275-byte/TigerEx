import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { placeFiatOrder, listFiatOrders, FiatError } from '@/lib/fiat/ramp';
import { getFiatProvider } from '@/lib/fiat/provider';
import { enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Start a fiat deposit (a fiat `buy`): pay fiat, receive crypto.
 *
 * The order is priced and recorded here, then handed to the provider. When no
 * provider is configured the order is refused — a deposit is never reported as
 * started when nothing could settle it. The crypto is credited only after the
 * provider's signed callback confirms the fiat was taken.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'fiat.deposit.post');
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
    const order = placeFiatOrder(auth.user.userId, 'buy', fiatCurrency, cryptoCurrency, fiatAmount, providerId);
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
    console.error('Fiat deposit error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'PROVIDER_ERROR', message: 'The fiat provider could not accept the order' } },
      { status: 502 },
    );
  }
}

/** The authenticated user's fiat deposit (buy) history. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = request.nextUrl;
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 100);
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

  const orders = listFiatOrders(auth.user.userId, limit, offset).filter((o) => o.direction === 'buy');
  return NextResponse.json({ success: true, data: orders }, { headers: NO_STORE });
}
