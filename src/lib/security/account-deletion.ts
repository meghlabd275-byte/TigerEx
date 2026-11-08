/**
 * Account deletion.
 *
 * Deletion is a two-step, verified action: a code is delivered to the address
 * on file, and only after it is verified does the account enter the `pending_deletion`
 * state with a scheduled deletion date. Funds must be withdrawn and open orders
 * cancelled first, so a deletion can never silently strand a balance or an
 * order. The code is delivered by the configured transport and never returned
 * to the caller.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';
import { issueOtp, verifyOtp, isOtpVerified } from '@/lib/security/otp';
import { availableBalance } from '@/lib/db/ledger';

export class DeletionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const PURPOSE = 'account_deletion' as const;
/** Days between a verified request and the account being removed. */
export const DELETION_GRACE_DAYS = 7;

function accountEmail(userId: string): string {
  const row = getDb().prepare('SELECT email, status FROM users WHERE user_id = ?').get(userId) as
    | { email: string | null; status: string }
    | undefined;
  if (!row) throw new DeletionError('NOT_FOUND', 'Account not found', 404);
  if (!row.email) throw new DeletionError('NO_EMAIL', 'This account has no email address on file');
  return row.email;
}

/** Every asset the account still holds a positive balance of. */
function heldAssets(userId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT b.currency AS currency, SUM(b.available + b.locked) AS total
         FROM balances b JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ?
        GROUP BY b.currency
       HAVING total > 0`,
    )
    .all(userId) as Array<{ currency: string; total: number }>;
  return rows.map((row) => String(row.currency));
}

function openOrderCount(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN ('pending', 'open', 'partially_filled')")
    .get(userId) as { n: number } | undefined;
  return Number(row?.n) || 0;
}

/**
 * Send a deletion verification code to the address on file.
 *
 * Fails closed when delivery is not configured, so a user is never told a code
 * was sent when it was not.
 */
export async function requestDeletion(userId: string): Promise<void> {
  const email = accountEmail(userId);
  const result = await issueOtp({ purpose: PURPOSE, userId, email });
  if (!result.delivered) {
    throw new DeletionError('DELIVERY_FAILED', 'The verification code could not be delivered', 503);
  }
}

export interface DeletionResult {
  status: string;
  scheduledFor: string;
  graceDays: number;
}

/**
 * Verify a deletion code and schedule the deletion.
 *
 * The account must have no open orders and no positive balance: a deletion
 * request that would strand funds or orders is refused with the offending
 * assets, so the user can withdraw first.
 */
export function confirmDeletion(userId: string, code: string): DeletionResult {
  const email = accountEmail(userId);
  const verification = verifyOtp(PURPOSE, { email }, String(code ?? '').trim());
  if (!verification.ok) {
    throw new DeletionError('INVALID_CODE', `The verification code is ${verification.reason ?? 'invalid'}`, 400);
  }

  const assets = heldAssets(userId);
  if (assets.length > 0) {
    throw new DeletionError(
      'BALANCE_NOT_EMPTY',
      `Withdraw your remaining balances before deleting the account: ${assets.join(', ')}`,
      409,
    );
  }
  const orders = openOrderCount(userId);
  if (orders > 0) {
    throw new DeletionError('OPEN_ORDERS', `Cancel your ${orders} open order(s) before deleting the account`, 409);
  }

  const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * 86400_000).toISOString();
  const db = getDb();
  db.prepare(
    "UPDATE users SET status = 'pending_deletion', updated_at = datetime('now') WHERE user_id = ?",
  ).run(userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);

  return { status: 'pending_deletion', scheduledFor, graceDays: DELETION_GRACE_DAYS };
}

/** Whether a verified deletion request is on file for the account. */
export function deletionRequested(userId: string): boolean {
  const email = accountEmail(userId);
  return isOtpVerified(PURPOSE, { email });
}

export { availableBalance };
