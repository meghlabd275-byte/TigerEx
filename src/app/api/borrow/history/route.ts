import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The caller's borrow and repay history.
 *
 * Read from the transaction ledger, which records every margin movement, so the
 * history is the same data the ledger used to move funds.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 100) || 100, 1), 1000);
  const rows = getDb()
    .prepare(
      `SELECT transaction_id, type, currency, amount, fee, status, memo, created_at
         FROM transactions
        WHERE user_id = ? AND type IN ('margin_borrow', 'margin_repay', 'margin_liquidation')
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(auth.user.userId, limit) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      history: rows.map((row) => ({
        transactionId: row.transaction_id,
        type: row.type,
        asset: row.currency,
        amount: row.amount,
        fee: row.fee,
        status: row.status,
        memo: row.memo,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}
