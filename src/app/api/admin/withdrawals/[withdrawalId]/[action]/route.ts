import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Approve or reject a pending withdrawal.
 *
 * Approval debits the locked balance (or the available balance when nothing was
 * locked) and records the transaction hash. Rejection releases the locked funds
 * back to the available balance. Both run inside one database transaction, so a
 * failure cannot leave the ledger half-updated.
 */

const ACTIONS = ['approve', 'reject'];

export async function POST(
  request: NextRequest,
  { params }: { params: { withdrawalId: string; action: string } },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.withdrawals.action');
  if (guard) return guard;

  const withdrawalId = params.withdrawalId;
  const action = params.action?.toLowerCase();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(withdrawalId)) {
    return fail('VALIDATION_FAILED', 'Invalid withdrawal id');
  }
  if (!ACTIONS.includes(action)) {
    return fail('VALIDATION_FAILED', `action must be one of ${ACTIONS.join(', ')}`);
  }

  const body = await readJson(request);
  const txHash = body && typeof body.txHash === 'string' ? body.txHash.trim() : '';
  const reason = body && typeof body.reason === 'string' ? body.reason.trim() : '';

  const db = getDb();
  const withdrawal = db
    .prepare('SELECT * FROM withdrawals WHERE withdrawal_id = ?')
    .get(withdrawalId) as
    | {
        withdrawal_id: string;
        user_id: string;
        currency: string;
        amount: number;
        fee: number;
        wallet_id: string | null;
        status: string;
      }
    | undefined;
  if (!withdrawal) return fail('UNKNOWN_WITHDRAWAL', 'No such withdrawal', 404);
  if (withdrawal.status !== 'pending') {
    return fail('ALREADY_PROCESSED', `This withdrawal is already ${withdrawal.status}`, 409);
  }

  const now = new Date().toISOString();
  const total = (Number(withdrawal.amount) || 0) + (Number(withdrawal.fee) || 0);

  try {
    db.transaction(() => {
      const walletRow = withdrawal.wallet_id
        ? (db.prepare('SELECT wallet_id FROM wallets WHERE wallet_id = ?').get(withdrawal.wallet_id) as { wallet_id: string } | undefined)
        : (db
            .prepare('SELECT wallet_id FROM wallets WHERE user_id = ? AND currency = ? LIMIT 1')
            .get(withdrawal.user_id, withdrawal.currency) as { wallet_id: string } | undefined);

      if (!walletRow) throw new Error('NO_WALLET');

      const balance = db
        .prepare('SELECT available, locked FROM balances WHERE wallet_id = ? AND currency = ?')
        .get(walletRow.wallet_id, withdrawal.currency) as { available: number; locked: number } | undefined;
      if (!balance) throw new Error('NO_BALANCE');

      if (action === 'approve') {
        // Prefer the locked amount; fall back to available when the request did
        // not lock funds (for example a withdrawal created by an operator).
        const fromLocked = Math.min(balance.locked, total);
        const fromAvailable = total - fromLocked;
        if (balance.available + fromLocked < total) throw new Error('INSUFFICIENT_FUNDS');

        db.prepare(
          `UPDATE balances
              SET locked = locked - ?, available = available - ?, updated_at = datetime('now')
            WHERE wallet_id = ? AND currency = ?`,
        ).run(fromLocked, fromAvailable, walletRow.wallet_id, withdrawal.currency);

        db.prepare(
          `UPDATE withdrawals SET status = 'completed', tx_hash = ?, processed_at = ? WHERE withdrawal_id = ?`,
        ).run(txHash || null, now, withdrawalId);
      } else {
        // Rejection returns whatever was locked to the available balance.
        const release = Math.min(balance.locked, total);
        db.prepare(
          `UPDATE balances
              SET locked = locked - ?, available = available + ?, updated_at = datetime('now')
            WHERE wallet_id = ? AND currency = ?`,
        ).run(release, release, walletRow.wallet_id, withdrawal.currency);

        db.prepare(
          `UPDATE withdrawals SET status = 'rejected', processed_at = ? WHERE withdrawal_id = ?`,
        ).run(now, withdrawalId);
      }
    })();
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TRANSACTION_FAILED';
    if (code === 'NO_WALLET') return fail('NO_WALLET', 'No wallet found for this withdrawal', 409);
    if (code === 'NO_BALANCE') return fail('NO_BALANCE', 'No balance row found for this withdrawal', 409);
    if (code === 'INSUFFICIENT_FUNDS') {
      return fail('INSUFFICIENT_FUNDS', 'The account does not hold enough to settle this withdrawal', 409);
    }
    return fail('PROCESSING_FAILED', 'The withdrawal could not be processed', 500);
  }

  recordAdminAction(request, auth.admin, action === 'approve' ? 'withdrawal.approve' : 'withdrawal.reject', {
    type: 'withdrawal',
    id: withdrawalId,
    detail: action === 'approve' ? { txHash: txHash || null } : { reason: reason || null },
  });

  return NextResponse.json(
    { success: true, withdrawalId, status: action === 'approve' ? 'completed' : 'rejected' },
    { headers: NO_STORE },
  );
}
