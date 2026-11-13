/**
 * Two-factor authentication for the administrator console.
 *
 * An admin session can approve withdrawals and move customer funds, so the
 * console supports an authenticator (RFC 6238 TOTP) on the same scheme a trader
 * account uses. The secret is stored AES-256-GCM encrypted; it is decrypted only
 * to check a submitted code.
 *
 * The module is free of `next/server` so the enrolment and verification paths
 * are unit tested directly, like the rest of the security layer.
 */

import { getDb } from '@/lib/db';
import {
  buildOtpauthUrl,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  verifyTotp,
} from '@/lib/security/totp';

export interface AdminTotpStatus {
  enabled: boolean;
  /** True once a secret is stored but no code has confirmed it yet. */
  pending: boolean;
}

/** The 2FA status of an administrator account. */
export function adminTotpStatus(adminId: string): AdminTotpStatus {
  const row = getDb()
    .prepare('SELECT two_factor_enabled, two_factor_secret FROM admin_users WHERE admin_id = ?')
    .get(adminId) as { two_factor_enabled: number | null; two_factor_secret: string | null } | undefined;
  if (!row) return { enabled: false, pending: false };
  return {
    enabled: Number(row.two_factor_enabled) === 1,
    pending: !row.two_factor_enabled && !!row.two_factor_secret,
  };
}

/**
 * Begin enrolment: issue a fresh secret, store it encrypted, and leave 2FA
 * disabled until a code proves the administrator holds the secret.
 */
export function beginAdminTotpEnrolment(adminId: string): { secret: string; otpauthUrl: string } {
  const db = getDb();
  const admin = db.prepare('SELECT email FROM admin_users WHERE admin_id = ?').get(adminId) as
    | { email: string }
    | undefined;
  if (!admin) throw new Error('ADMIN_NOT_FOUND');

  const secret = generateTotpSecret();
  db.prepare(
    "UPDATE admin_users SET two_factor_secret = ?, two_factor_enabled = 0 WHERE admin_id = ?",
  ).run(encryptSecret(secret), adminId);

  return { secret, otpauthUrl: buildOtpauthUrl(secret, admin.email) };
}

/**
 * Confirm enrolment with a code from the authenticator. Only a correct code
 * flips `two_factor_enabled`, so 2FA is never reported as on before the
 * administrator has proven possession of the secret.
 */
export function confirmAdminTotpEnrolment(adminId: string, code: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT two_factor_secret FROM admin_users WHERE admin_id = ?')
    .get(adminId) as { two_factor_secret: string | null } | undefined;
  if (!row?.two_factor_secret) throw new Error('NO_PENDING_SECRET');

  const secret = decryptSecret(row.two_factor_secret);
  if (!verifyTotp(secret, code)) return false;

  db.prepare('UPDATE admin_users SET two_factor_enabled = 1 WHERE admin_id = ?').run(adminId);
  return true;
}

/**
 * Verify a submitted code against the administrator's enrolled secret.
 *
 * Returns false when 2FA is not enabled, so a caller that gates a sensitive
 * action on a code cannot be satisfied by an account that never enrolled.
 */
export function verifyAdminTotp(adminId: string, code: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT two_factor_enabled, two_factor_secret FROM admin_users WHERE admin_id = ?')
    .get(adminId) as { two_factor_enabled: number | null; two_factor_secret: string | null } | undefined;
  if (!row || Number(row.two_factor_enabled) !== 1 || !row.two_factor_secret) return false;

  let secret: string;
  try {
    secret = decryptSecret(row.two_factor_secret);
  } catch {
    return false;
  }
  return verifyTotp(secret, code);
}

/** Turn admin 2FA off after a verified code. Returns false on a bad code. */
export function disableAdminTotp(adminId: string, code: string): boolean {
  if (!verifyAdminTotp(adminId, code)) return false;
  getDb()
    .prepare('UPDATE admin_users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE admin_id = ?')
    .run(adminId);
  return true;
}
