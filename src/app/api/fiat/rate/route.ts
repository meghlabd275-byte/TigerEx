import { NextRequest, NextResponse } from 'next/server';
import { conversionRate } from '@/lib/db/convert';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The live crypto/fiat rate for a pair, read from this venue's own market data.
 *
 * There is no external FX feed and no fallback: when no rate exists the route
 * reports it as unavailable rather than returning a fabricated number.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const fiat = (searchParams.get('currency') ?? 'USD').toUpperCase();
  const crypto = (searchParams.get('asset') ?? searchParams.get('cryptoCurrency') ?? '').toUpperCase();

  if (!crypto) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_PARAMS', message: 'asset (the crypto currency) is required' } },
      { status: 400 },
    );
  }

  const rate = conversionRate(crypto, fiat);
  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'RATE_UNAVAILABLE', message: `No live ${crypto}/${fiat} rate is available` },
      },
      { status: 409, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    { success: true, data: { asset: crypto, currency: fiat, rate } },
    { headers: NO_STORE },
  );
}
