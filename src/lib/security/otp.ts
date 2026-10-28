import { createHash, randomInt } from 'crypto';
import { getDb, generateId } from '@/lib/db';
import { getEmailSender } from '@/lib/security/email';

/**
 * Verification codes (OTP).
 *
 * Codes are stored as a SHA-256 digest bound to the account, never in plain
 * text, and are single-use with an attempt cap and expiry. Every lookup is
 * parameterised, so no caller input reaches SQL as text.
 */

export type OtpPurpose =
  | 'login'
  | 'register'
  | 'password_reset'
  | '2fa_reset'
  | 'email_verify'
  | 'phone_verify';

export interface IssueOptions {
  purpose: OtpPurpose;
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
  ttlSeconds?: number;
  maxAttempts?: number;
}

const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_MAX_ATTEMPTS = 5;

function digestCode(accountKey: string, code: string): string {
  // Bind the digest to the account so a leaked digest is not replayable
  // against a different account.
  return createHash('sha256').update(`${accountKey}:${code}`).digest('hex');
}

function accountKeyOf(email: string | null, phone: string | null): string {
  return (email || phone || '').trim().toLowerCase();
}

/**
 * Create and deliver a verification code.
 *
 * Returns the code only when a delivery channel accepted it. If delivery is not
 * configured the record is not written and `delivered` is false, so callers
 * cannot mistake an undelivered code for a sent one.
 */
export async function issueOtp(
  options: IssueOptions,
): Promise<{ delivered: boolean; reason?: string; expiresAt?: string }> {
  const { purpose, ttlSeconds = DEFAULT_TTL_SECONDS, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;
  const email = options.email ? options.email.trim().toLowerCase() : null;
  const phone = options.phone ? options.phone.trim() : null;

  if (!email && !phone) {
    return { delivered: false, reason: 'NO_DESTINATION' };
  }

  const sender = email ? getEmailSender() : null;
  if (email && !sender) {
    return { delivered: false, reason: 'EMAIL_DELIVERY_NOT_CONFIGURED' };
  }
  if (!email && phone) {
    // SMS delivery has no configured provider; fail closed rather than pretend.
    return { delivered: false, reason: 'SMS_DELIVERY_NOT_CONFIGURED' };
  }

  const code = randomInt(100000, 1000000).toString();
  const accountKey = accountKeyOf(email, phone);
  const db = getDb();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Invalidate any outstanding codes for this account and purpose.
  db.prepare(
    `UPDATE otp_codes SET verified_at = datetime('now')
      WHERE purpose = ? AND verified_at IS NULL
        AND ((email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?))`,
  ).run(purpose, email, phone);

  db.prepare(
    `INSERT INTO otp_codes
       (otp_id, user_id, email, phone, code, type, purpose, attempts, max_attempts, expires_at)
     VALUES (?, ?, ?, ?, ?, 'numeric', ?, 0, ?, ?)`,
  ).run(generateId(), options.userId ?? null, email, phone, digestCode(accountKey, code), purpose, maxAttempts, expiresAt);

  try {
    await sender!.send(
      email!,
      'Your TigerEx verification code',
      `Your TigerEx verification code is ${code}. It expires in ${Math.round(ttlSeconds / 60)} minutes. If you did not request this, ignore this message.`,
    );
  } catch (error) {
    // Delivery failed: remove the code so the flow cannot proceed.
    db.prepare(`DELETE FROM otp_codes WHERE email = ? AND purpose = ? AND verified_at IS NULL`).run(
      email,
      purpose,
    );
    console.error('OTP delivery failed:', error);
    return { delivered: false, reason: 'DELIVERY_FAILED' };
  }

  return { delivered: true, expiresAt };
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'NOT_FOUND' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'MISMATCH';
  userId?: string | null;
}

/**
 * Verify a submitted code.
 *
 * On success the record is marked verified and cannot be reused. Failed
 * attempts are counted so a code cannot be brute-forced.
 */
export function verifyOtp(
  purpose: OtpPurpose,
  destination: { email?: string | null; phone?: string | null },
  code: string,
): VerifyResult {
  const email = destination.email ? destination.email.trim().toLowerCase() : null;
  const phone = destination.phone ? destination.phone.trim() : null;
  const accountKey = accountKeyOf(email, phone);
  if (!accountKey || !code) return { ok: false, reason: 'NOT_FOUND' };

  const db = getDb();
  const row = db
    .prepare(
      `SELECT otp_id, user_id, code, attempts, max_attempts, expires_at
         FROM otp_codes
        WHERE purpose = ? AND verified_at IS NULL
          AND ((email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?))
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(purpose, email, phone) as
    | { otp_id: string; user_id: string | null; code: string; attempts: number; max_attempts: number; expires_at: string }
    | undefined;

  if (!row) return { ok: false, reason: 'NOT_FOUND' };

  if (row.attempts >= row.max_attempts) {
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, reason: 'EXPIRED' };
  }

  const expected = digestCode(accountKey, code);
  if (expected !== row.code) {
    db.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE otp_id = ?`).run(row.otp_id);
    return { ok: false, reason: 'MISMATCH' };
  }

  db.prepare(`UPDATE otp_codes SET verified_at = datetime('now') WHERE otp_id = ?`).run(row.otp_id);
  return { ok: true, userId: row.user_id };
}

/** Whether a purpose-specific code was already verified and is still fresh. */
export function isOtpVerified(
  purpose: OtpPurpose,
  destination: { email?: string | null; phone?: string | null },
  withinMinutes = 15,
): boolean {
  const email = destination.email ? destination.email.trim().toLowerCase() : null;
  const phone = destination.phone ? destination.phone.trim() : null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT otp_id FROM otp_codes
        WHERE purpose = ? AND verified_at IS NOT NULL
          AND verified_at >= datetime('now', ?)
          AND ((email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?))
        ORDER BY verified_at DESC LIMIT 1`,
    )
    .get(purpose, `-${withinMinutes} minutes`, email, phone) as { otp_id: string } | undefined;
  return !!row;
}
