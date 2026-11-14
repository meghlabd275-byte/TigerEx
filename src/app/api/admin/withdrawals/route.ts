import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The withdrawal queue.
 *
 * Read from the exchange's own `withdrawals` table so the console can review
 * pending requests before approving them. No secret or key material is read.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status')?.trim();
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 100) || 100, 1), 500);
  const offset = Math.max(Number(searchParams.get('offset') ?? 0) || 0, 0);

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (status) {
    clauses.push('w.status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(
      `SELECT w.withdrawal_id, w.user_id, w.currency, w.network, w.amount, w.fee, w.address,
              w.memo, w.tx_hash, w.status, w.created_at, w.processed_at
         FROM withdrawals w${where}
        ORDER BY w.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      withdrawals: rows.map((row) => ({
        id: row.withdrawal_id,
        userId: row.user_id,
        asset: row.currency,
        network: row.network,
        amount: Number(row.amount) || 0,
        fee: Number(row.fee) || 0,
        netAmount: (Number(row.amount) || 0) - (Number(row.fee) || 0),
        address: row.address,
        memo: row.memo ?? null,
        txHash: row.tx_hash ?? null,
        status: row.status,
        createdAt: row.created_at,
        processedAt: row.processed_at ?? null,
      })),
    },
    { headers: NO_STORE },
  );
}
