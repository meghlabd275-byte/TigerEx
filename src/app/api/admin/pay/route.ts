import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * TigerPay transfer monitoring.
 *
 * Transfers move between users by email, phone or account id. The operator sees
 * the flow and the claim state; the transfer itself is executed by the pay
 * engine, not by this route.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status')?.trim();
  const clauses: string[] = [];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(
      `SELECT transfer_id, sender_id, recipient_ref, recipient_user_id, asset, amount, memo,
              status, created_at, claimed_at
         FROM pay_transfers${where}
        ORDER BY created_at DESC LIMIT 1000`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  const totals = getDb()
    .prepare("SELECT asset, COALESCE(SUM(amount), 0) AS total FROM pay_transfers WHERE status = 'claimed' GROUP BY asset")
    .all() as Array<{ asset: string; total: number }>;

  return NextResponse.json(
    {
      success: true,
      transfers: rows.map((row) => ({
        transferId: row.transfer_id,
        senderId: row.sender_id,
        recipientRef: row.recipient_ref,
        recipientUserId: row.recipient_user_id ?? null,
        asset: row.asset,
        amount: row.amount,
        memo: row.memo ?? null,
        status: row.status,
        createdAt: row.created_at,
        claimedAt: row.claimed_at ?? null,
      })),
      settledTotals: totals.map((row) => ({ asset: row.asset, total: Number(row.total) || 0 })),
    },
    { headers: NO_STORE },
  );
}
