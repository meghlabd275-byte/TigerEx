import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { getDb } from '@/lib/db';

/** Cards issued to the authenticated user, with month-to-date spend and cashback. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT card_id, card_type, brand, last4, currency, status, created_at
           FROM cards WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(auth.user.userId) as Array<{
      card_id: string;
      card_type: string;
      brand: string;
      last4: string;
      currency: string;
      status: string;
      created_at: string;
    }>;

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(ABS(amount)), 0) AS spend,
                COALESCE(SUM(cashback), 0) AS cashback
           FROM card_transactions
          WHERE user_id = ? AND created_at >= ?`,
      )
      .get(auth.user.userId, monthStart.toISOString()) as { spend: number; cashback: number };

    return NextResponse.json(
      {
        success: true,
        data: {
          cards: rows.map((c) => ({
            cardId: c.card_id,
            type: c.card_type,
            brand: c.brand,
            last4: c.last4,
            currency: c.currency,
            status: c.status,
            createdAt: c.created_at,
          })),
          monthSpend: totals.spend,
          cashback: totals.cashback,
          activeCards: rows.filter((c) => c.status === 'active').length,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Card list error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
