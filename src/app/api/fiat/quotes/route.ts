import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { quoteFiat, FiatError, type FiatDirection } from '@/lib/fiat/ramp';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

const DIRECTIONS = new Set(['buy', 'sell']);

/**
 * Quote a fiat buy or sell from this venue's own market data.
 *
 * No provider SDK is consulted and no rate is invented: an unpriceable pair
 * fails closed with RATE_UNAVAILABLE rather than quoting a made-up number.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = request.nextUrl;
  const direction = (searchParams.get('direction') ?? 'buy').toLowerCase();
  const fiatCurrency = (searchParams.get('fiatCurrency') ?? searchParams.get('currency') ?? '').toUpperCase();
  const cryptoCurrency = (searchParams.get('cryptoCurrency') ?? searchParams.get('asset') ?? '').toUpperCase();
  const fiatAmount = Number(searchParams.get('amount') ?? searchParams.get('fiatAmount') ?? '');
  const providerId = searchParams.get('providerId');

  if (!DIRECTIONS.has(direction)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_DIRECTION', message: 'direction must be buy or sell' } },
      { status: 400 },
    );
  }
  if (!fiatCurrency || !cryptoCurrency || !Number.isFinite(fiatAmount)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_PARAMS', message: 'fiatCurrency, cryptoCurrency and amount are required' } },
      { status: 400 },
    );
  }

  try {
    const quote = quoteFiat(direction as FiatDirection, fiatCurrency, cryptoCurrency, fiatAmount, providerId);
    return NextResponse.json({ success: true, data: quote }, { headers: NO_STORE });
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
