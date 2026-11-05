/**
 * Internal transfers between accounts.
 *
 * A transfer moves funds from the sender to the recipient in one database
 * transaction, so a failure cannot debit the sender without crediting the
 * recipient. The recipient is resolved by email or phone to a real account; an
 * unknown recipient is refused rather than parked.
 */

import { getDb } from '@/lib/db';
import { debitAvailable, creditAvailable, recordTransaction } from '@/lib/db/ledger';

export class TransferError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface TransferResult {
  transferId: string;
  asset: string;
  amount: number;
  recipientId: string;
  recipient: string;
}

/** Resolve an email or phone to a user id. */
function resolveRecipient(recipient: string): { userId: string; label: string } | null {
  const value = String(recipient ?? '').trim();
  if (!value) return null;

  const db = getDb();
  if (value.includes('@')) {
    const row = db
      .prepare('SELECT user_id, email FROM users WHERE LOWER(email) = ?')
      .get(value.toLowerCase()) as { user_id: string; email: string } | undefined;
    return row ? { userId: row.user_id, label: row.email } : null;
  }

  const normalizedPhone = value.replace(/[^\d+]/g, '');
  const row = db
    .prepare('SELECT user_id, phone FROM users WHERE phone = ? OR phone = ?')
    .get(value, normalizedPhone) as { user_id: string; phone: string } | undefined;
  return row ? { userId: row.user_id, label: row.phone } : null;
}

/**
 * Transfer funds to another account.
 *
 * The sender must hold the funds, the recipient must exist and the two must be
 * different accounts. Both balance movements and both transaction rows are
 * written inside one transaction.
 */
export function internalTransfer(
  senderId: string,
  recipient: string,
  asset: string,
  amount: number,
): TransferResult {
  const upperAsset = String(asset ?? '').trim().toUpperCase();
  const value = Number(amount);

  if (!upperAsset) throw new TransferError('VALIDATION_FAILED', 'An asset is required');
  if (!Number.isFinite(value) || value <= 0) {
    throw new TransferError('INVALID_AMOUNT', 'Amount must be a positive number');
  }

  const target = resolveRecipient(recipient);
  if (!target) {
    throw new TransferError('RECIPIENT_NOT_FOUND', 'No account matches that email or phone number', 404);
  }
  if (target.userId === senderId) {
    throw new TransferError('SELF_TRANSFER', 'You cannot transfer to your own account');
  }

  const db = getDb();
  const transferId = `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  db.transaction(() => {
    debitAvailable(senderId, upperAsset, value);
    creditAvailable(target.userId, upperAsset, value);
    recordTransaction(senderId, 'transfer_out', upperAsset, value, 0, 'completed', `Transfer ${transferId} to ${target.label}`);
    recordTransaction(target.userId, 'transfer_in', upperAsset, value, 0, 'completed', `Transfer ${transferId}`);
  })();

  return {
    transferId,
    asset: upperAsset,
    amount: value,
    recipientId: target.userId,
    recipient: target.label,
  };
}

/** The account's own transfer history, from the transaction log. */
export function transferHistory(userId: string, limit = 100): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare(
      `SELECT transaction_id, type, currency, amount, fee, status, memo, created_at
         FROM transactions
        WHERE user_id = ? AND type IN ('transfer_in', 'transfer_out')
        ORDER BY created_at DESC, transaction_id DESC
        LIMIT ?`,
    )
    .all(userId, Math.min(Math.max(Math.trunc(limit) || 100, 1), 500)) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.transaction_id,
    type: String(row.type) === 'transfer_in' ? 'transfer' : 'transfer',
    direction: String(row.type) === 'transfer_in' ? 'in' : 'out',
    coin: row.currency,
    asset: row.currency,
    amount: Number(row.amount) || 0,
    fee: Number(row.fee) || 0,
    status: row.status,
    memo: row.memo ?? null,
    created_at: row.created_at,
    createdAt: row.created_at,
  }));
}
