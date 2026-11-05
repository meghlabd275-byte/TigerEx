/**
 * Changing the email address on an account.
 *
 * Two steps, both delivered by email, so a stolen session alone cannot move an
 * account to an attacker's address. The first code proves control of the
 * current address, the second control of the new one; only then is the row
 * updated, and every other session is revoked.
 *
 * A code is never returned to a caller or written to a log — it goes out over
 * the configured SMTP transport, and if that transport is absent the step fails
 * closed with `DELIVERY_FAILED`.
 */

import { getDb } from '@/lib/db';
import { issueOtp, verifyOtp } from '@/lib/security/otp';

export class EmailChangeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const PURPOSE_OLD = 'email_change_old' as const;
const PURPOSE_NEW = 'email_change_new' as const;

function normalizeEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new EmailChangeError('INVALID_EMAIL', 'A valid email address is required');
  }
  return email;
}

function accountEmail(userId: string): string {
  const row = getDb().prepare('SELECT email FROM users WHERE user_id = ?').get(userId) as
    | { email: string | null }
    | undefined;
  if (!row) throw new EmailChangeError('NOT_FOUND', 'Account not found', 404);
  if (!row.email) throw new EmailChangeError('NO_EMAIL', 'This account has no email address on file');
  return row.email;
}

async function deliver(userId: string, email: string, purpose: typeof PURPOSE_OLD | typeof PURPOSE_NEW) {
  const result = await issueOtp({ purpose, userId, email });
  if (!result.delivered) {
    throw new EmailChangeError(
      'DELIVERY_FAILED',
      'The verification code could not be delivered to that address',
      503,
    );
  }
}

/** Send a code to the address currently on the account. */
export async function beginEmailChange(userId: string, currentEmail: unknown): Promise<void> {
  const onFile = accountEmail(userId);
  const claimed = normalizeEmail(currentEmail);
  // A mismatch is refused rather than silently ignored: a caller who cannot
  // name the current address should not receive a code for it.
  if (claimed !== onFile.toLowerCase()) {
    throw new EmailChangeError('EMAIL_MISMATCH', 'That is not the email address on this account');
  }
  await deliver(userId, onFile, PURPOSE_OLD);
}

/** Confirm the current address, then send a code to the new one. */
export async function verifyCurrentEmail(
  userId: string,
  currentEmail: unknown,
  code: unknown,
): Promise<void> {
  const onFile = accountEmail(userId);
  const claimed = normalizeEmail(currentEmail);
  if (claimed !== onFile.toLowerCase()) {
    throw new EmailChangeError('EMAIL_MISMATCH', 'That is not the email address on this account');
  }

  const result = verifyOtp(PURPOSE_OLD, { email: onFile }, String(code ?? '').trim());
  if (!result.ok) {
    throw new EmailChangeError(
      result.reason === 'TOO_MANY_ATTEMPTS' ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CODE',
      'The verification code is not valid',
      result.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 400,
    );
  }
}

/** Send a code to the address the account is moving to. */
export async function sendNewEmailCode(userId: string, newEmail: unknown): Promise<void> {
  const onFile = accountEmail(userId);
  const target = normalizeEmail(newEmail);
  if (target === onFile.toLowerCase()) {
    throw new EmailChangeError('SAME_EMAIL', 'The new address must differ from the current one');
  }
  const taken = getDb().prepare('SELECT user_id FROM users WHERE LOWER(email) = ?').get(target);
  if (taken) throw new EmailChangeError('EMAIL_TAKEN', 'An account already uses that email address', 409);
  await deliver(userId, target, PURPOSE_NEW);
}

/** Confirm the new address. Does not change the account yet. */
export function verifyNewEmail(userId: string, newEmail: unknown, code: unknown): void {
  const target = normalizeEmail(newEmail);
  const taken = getDb().prepare('SELECT user_id FROM users WHERE LOWER(email) = ?').get(target);
  if (taken) throw new EmailChangeError('EMAIL_TAKEN', 'An account already uses that email address', 409);

  const result = verifyOtp(PURPOSE_NEW, { email: target }, String(code ?? '').trim());
  if (!result.ok) {
    throw new EmailChangeError(
      result.reason === 'TOO_MANY_ATTEMPTS' ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CODE',
      'The verification code is not valid',
      result.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 400,
    );
  }
}

/**
 * Commit the change.
 *
 * Both codes must be freshly verified, the address must still be free, and the
 * update plus the revocation of every other session happen in one transaction
 * so a partially applied change is impossible.
 */
export function completeEmailChange(
  userId: string,
  currentEmail: unknown,
  newEmail: unknown,
  currentToken: string | null,
): { email: string } {
  const onFile = accountEmail(userId);
  const claimed = normalizeEmail(currentEmail);
  const target = normalizeEmail(newEmail);

  if (claimed !== onFile.toLowerCase()) {
    throw new EmailChangeError('EMAIL_MISMATCH', 'That is not the email address on this account');
  }
  if (!isVerifiedRecently(PURPOSE_OLD, onFile) || !isVerifiedRecently(PURPOSE_NEW, target)) {
    throw new EmailChangeError('VERIFICATION_REQUIRED', 'Both email addresses must be verified first');
  }

  const db = getDb();
  db.transaction(() => {
    const taken = db
      .prepare('SELECT user_id FROM users WHERE LOWER(email) = ? AND user_id != ?')
      .get(target, userId);
    if (taken) throw new EmailChangeError('EMAIL_TAKEN', 'An account already uses that email address', 409);

    db.prepare("UPDATE users SET email = ?, email_verified = 0, updated_at = datetime('now') WHERE user_id = ?").run(
      target,
      userId,
    );
    // A change of recovery address invalidates every other session; the caller
    // keeps the one they are using.
    if (currentToken) {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND access_token != ?').run(userId, currentToken);
    } else {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
  })();

  return { email: target };
}

function isVerifiedRecently(purpose: typeof PURPOSE_OLD | typeof PURPOSE_NEW, email: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT otp_id FROM otp_codes
        WHERE purpose = ? AND verified_at IS NOT NULL
          AND verified_at >= datetime('now', '-15 minutes')
          AND email = ?
        ORDER BY verified_at DESC LIMIT 1`,
    )
    .get(purpose, email) as { otp_id: string } | undefined;
  return !!row;
}
