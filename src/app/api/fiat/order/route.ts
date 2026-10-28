import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { conversionRate } from '@/lib/db/convert';

const DIRECTIONS = new Set(['buy', 'sell']);

/**
 * Place a fiat buy/sell order.
 *
 * The order is recorded against a configured provider and priced with the live
 * market rate; the provider settles it asynchronously, so the order starts in
 * `pending`. No fiat is credited until the provider confirms settlement.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const direction = String(body.direction ?? '').toLowerCase();
  const fiatCurrency = String(body.fiatCurrency ?? '').toUpperCase();
  const cryptoCurrency = String(body.cryptoCurrency ?? '').toUpperCase();
  const providerId = body.providerId ? String(body.providerId) : null;
  const fiatAmount = typeof body.fiatAmount === 'number' ? body.fiatAmount : parseFloat(String(body.fiatAmount ?? ''));

  if (!DIRECTIONS.has(direction)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_DIRECTION', message: 'direction must be buy or sell' } },
      { status: 400 },
    );
  }
  if (!fiatCurrency || !cryptoCurrency || !Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_PARAMS', message: 'fiatCurrency, cryptoCurrency and a positive fiatAmount are required' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();

    let providerFeePercent = 0;
    if (providerId) {
      const provider = db
        .prepare(`SELECT min_limit, max_limit, fee_percent FROM fiat_providers WHERE provider_id = ? AND status = 'active'`)
        .get(providerId) as { min_limit: number; max_limit: number; fee_percent: number } | undefined;
      if (!provider) {
        return NextResponse.json(
          { success: false, error: { code: 'UNKNOWN_PROVIDER', message: 'Provider is not available' } },
          { status: 400 },
        );
      }
      if (fiatAmount < provider.min_limit || fiatAmount > provider.max_limit) {
        return NextResponse.json(
          { success: false, error: { code: 'OUT_OF_LIMITS', message: 'Amount is outside the provider limits' } },
          { status: 400 },
        );
      }
      providerFeePercent = provider.fee_percent;
    }

    // Price the crypto leg with the market rate (crypto per unit of fiat).
    const cryptoPerFiat = conversionRate(fiatCurrency, cryptoCurrency);
    const fee = (fiatAmount * providerFeePercent) / 100;
    const cryptoAmount = cryptoPerFiat === null ? null : (fiatAmount - fee) * cryptoPerFiat;

    const orderId = generateId();
    db.prepare(
      `INSERT INTO fiat_orders
         (order_id, user_id, provider_id, direction, fiat_currency, crypto_currency,
          fiat_amount, crypto_amount, rate, fee, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      orderId,
      auth.user.userId,
      providerId,
      direction,
      fiatCurrency,
      cryptoCurrency,
      fiatAmount,
      cryptoAmount,
      cryptoPerFiat,
      fee,
    );

    return NextResponse.json(
      {
        success: true,
        data: { orderId, direction, fiatCurrency, cryptoCurrency, fiatAmount, cryptoAmount, rate: cryptoPerFiat, fee, status: 'pending' },
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Fiat order error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
