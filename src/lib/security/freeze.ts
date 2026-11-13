/**
 * Withdrawal security holds.
 *
 * After a security-sensitive account change — a password change, a 2FA reset,
 * an email change, a new device or a suspicious login — withdrawals are held for
 * a cooling-off window (48 hours by default). The window is the standard
 * protection against an attacker who has taken over an account and immediately
 * tries to drain it: the legitimate owner has time to notice and respond.
 *
 * The hold is a property of the account, stored on `users.withdrawal_hold_until`
 * as a zone-less UTC timestamp. The comparison goes through `datetime()` so the
 * two shapes of timestamp the codebase writes never sort wrongly against each
 * other. The module is free of `next/server` so it can be unit tested.
 */

import { getDb } from '@/lib/db';

/** Default cooling-off window in hours. */
export const DEFAULT_HOLD_HOURS = 48;

export interface WithdrawalHoldStatus {
  /** True while a withdrawal must be refused. */
  held: boolean;
  /** The instant the hold lifts, ISO-8601, or null when not held. */
  until: string | null;
  /** Hours remaining, rounded up, or 0 when not held. */
  hoursRemaining: number;
  reason: string | null;
}

function holdHours(): number {
  const configured = Number(process.env.TIGEREX_WITHDRAWAL_HOLD_HOURS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return DEFAULT_HOLD_HOURS;
}

/**
 * Place a cooling-off hold on the account.
 *
 * The window is measured from now, so a second sensitive change extends the
 * hold rather than shortening it. Returns the instant it lifts.
 */
export function placeWithdrawalHold(userId: string, reason: string, hours = holdHours()): string {
  const safeHours = Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_HOLD_HOURS;
  const db = getDb();
  const until = db
    .prepare("SELECT datetime('now', ?) AS until")
    .get(`+${safeHours} hours`) as { until: string };

  db.prepare(
    `UPDATE users
        SET withdrawal_hold_until = ?,
            withdrawal_hold_reason = ?,
            updated_at = datetime('now')
      WHERE user_id = ?`,
  ).run(until.until, reason.slice(0, 200), userId);

  return until.until;
}

/**
 * The current hold status for an account.
 *
 * A hold whose `until` is in the past is reported as not held; the row is left
 * in place as an audit trail rather than being cleared.
 */
export function withdrawalHoldStatus(userId: string, now = new Date()): WithdrawalHoldStatus {
  const row = getDb()
    .prepare(
      `SELECT withdrawal_hold_until AS until, withdrawal_hold_reason AS reason
         FROM users WHERE user_id = ?`,
    )
    .get(userId) as { until: string | null; reason: string | null } | undefined;

  if (!row || !row.until) {
    return { held: false, until: null, hoursRemaining: 0, reason: null };
  }

  // `datetime()` normalises both `YYYY-MM-DD HH:MM:SS` and the ISO shape the
  // comparison value carries, so the two never sort wrongly against each other.
  const comparison = getDb()
    .prepare("SELECT datetime(?) > datetime('now') AS held, datetime(?) AS until_iso")
    .get(row.until, row.until) as { held: number; until_iso: string };

  if (comparison.held !== 1) {
    return { held: false, until: row.until, hoursRemaining: 0, reason: row.reason ?? null };
  }

  const remainingMs = new Date(`${comparison.until_iso.replace(' ', 'T')}Z`).getTime() - now.getTime();
  const hoursRemaining = Math.max(1, Math.ceil(remainingMs / 3_600_000));
  return { held: true, until: row.until, hoursRemaining, reason: row.reason ?? null };
}

/**
 * Refuse when the account is inside a cooling-off window.
 *
 * Returns the status so a caller can surface the remaining time; it throws
 * nothing, because the caller decides how to present the refusal.
 */
export function assertWithdrawalAllowed(userId: string): WithdrawalHoldStatus {
  return withdrawalHoldStatus(userId);
}

/** Lift a hold early. Used by an operator after a verified owner request. */
export function clearWithdrawalHold(userId: string): void {
  getDb()
    .prepare(
      `UPDATE users
          SET withdrawal_hold_until = NULL, withdrawal_hold_reason = NULL, updated_at = datetime('now')
        WHERE user_id = ?`,
    )
    .run(userId);
}
