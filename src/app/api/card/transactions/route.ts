import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { getDb } from '@/lib/db';

const MAX_LIMIT = 100;

/** Card transactions for the authenticated user, newest first. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT t.transaction_id, t.card_id, t.merchant, t.amount, t.currency,
                t.cashback, t.status, t.created_at, c.last4
           FROM card_transactions t
           LEFT JOIN cards c ON c.card_id = t.card_id
          WHERE t.user_id = ?
          ORDER BY t.created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(auth.user.userId, limit, offset) as Array<{
      transaction_id: string;
      card_id: string;
      merchant: string;
      amount: number;
      currency: string;
      cashback: number;
      status: string;
      created_at: string;
      last4: string | null;
    }>;

    return NextResponse.json(
      {
        success: true,
        data: rows.map((t) => ({
          transactionId: t.transaction_id,
          cardId: t.card_id,
          last4: t.last4,
          merchant: t.merchant,
          amount: t.amount,
          currency: t.currency,
          cashback: t.cashback,
          status: t.status,
          createdAt: t.created_at,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Card transactions error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
