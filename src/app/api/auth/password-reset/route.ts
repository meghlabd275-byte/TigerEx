import { NextRequest, NextResponse } from 'next/server';
import { getDb, hashPassword } from '@/lib/db';
import { isOtpVerified } from '@/lib/security/otp';
import { parseDestination, readJson } from '@/lib/security/otp-request';
import { decryptSecret, verifyTotp } from '@/lib/security/totp';

/**
 * Complete a password reset.
 *
 * Requires a password_reset code that was verified for this exact account
 * within the last 15 minutes, so a consumed code cannot be replayed and an
 * unverified request cannot change a password. When the account has a second
 * factor enrolled, a valid authenticator code is also required; the reset must
 * never complete with the second factor bypassed. All existing sessions are
 * revoked once the password changes.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const destination = parseDestination(body.emailOrPhone);
  const newPassword = String(body.newPassword ?? '');

  if (!destination || !newPassword) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Email/phone and a new password are required' } },
      { status: 400 },
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { success: false, error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' } },
      { status: 400 },
    );
  }

  if (!isOtpVerified('password_reset', destination)) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_VERIFIED', message: 'Verify the reset code before setting a new password' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const user = destination.email
      ? (db.prepare('SELECT user_id, two_factor_enabled, two_factor_secret FROM users WHERE email = ?').get(destination.email) as
          | { user_id: string; two_factor_enabled: number; two_factor_secret: string | null }
          | undefined)
      : (db.prepare('SELECT user_id, two_factor_enabled, two_factor_secret FROM users WHERE phone = ?').get(destination.phone) as
          | { user_id: string; two_factor_enabled: number; two_factor_secret: string | null }
          | undefined);

    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 },
      );
    }

    // A second factor must be satisfied before a reset completes.
    if (user.two_factor_enabled) {
      const totpCode = String(body.totpCode ?? '').trim();
      if (!totpCode) {
        return NextResponse.json(
          { success: false, error: { code: 'TOTP_REQUIRED', message: 'Enter your authenticator code to reset the password' } },
          { status: 400 },
        );
      }
      const secret = user.two_factor_secret ? decryptSecret(user.two_factor_secret) : '';
      if (!secret || !verifyTotp(secret, totpCode)) {
        return NextResponse.json(
          { success: false, error: { code: 'TOTP_INVALID', message: 'Invalid authenticator code' } },
          { status: 400 },
        );
      }
    }

    const apply = db.transaction(() => {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
        hashPassword(newPassword),
        user.user_id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.user_id);
    });
    apply();

    return NextResponse.json({ success: true, data: { reset: true } });
  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Password reset failed' } },
      { status: 500 },
    );
  }
}
