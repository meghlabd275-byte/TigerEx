import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';

/** Fiat buy/sell orders for the authenticated user, newest first. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT order_id, provider_id, direction, fiat_currency, crypto_currency,
                fiat_amount, crypto_amount, rate, fee, status, created_at
           FROM fiat_orders
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(auth.user.userId, limit, offset) as Array<Record<string, unknown>>;

    return NextResponse.json(
      {
        success: true,
        data: rows.map((r) => ({
          orderId: r.order_id,
          providerId: r.provider_id,
          direction: r.direction,
          fiatCurrency: r.fiat_currency,
          cryptoCurrency: r.crypto_currency,
          fiatAmount: r.fiat_amount,
          cryptoAmount: r.crypto_amount,
          rate: r.rate,
          fee: r.fee,
          status: r.status,
          createdAt: r.created_at,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Fiat orders error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
