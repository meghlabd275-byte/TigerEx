import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isOtpVerified } from '@/lib/security/otp';
import { parseDestination, readJson } from '@/lib/security/otp-request';

/**
 * Reset a lost second factor.
 *
 * Requires a verified 2fa_reset code for the account. On success the stored
 * authenticator secret is cleared and 2FA is disabled, so the account holder
 * can enrol a new device. Every session is revoked because the reset proves
 * control of the recovery channel, not of the existing sessions.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const destination = parseDestination(body.emailOrPhone);

  if (!destination) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'A valid email or phone number is required' } },
      { status: 400 },
    );
  }

  if (!isOtpVerified('2fa_reset', destination)) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_VERIFIED', message: 'Verify the reset code before resetting 2FA' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const user = destination.email
      ? (db.prepare('SELECT user_id FROM users WHERE email = ?').get(destination.email) as { user_id: string } | undefined)
      : (db.prepare('SELECT user_id FROM users WHERE phone = ?').get(destination.phone) as { user_id: string } | undefined);

    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 },
      );
    }

    const apply = db.transaction(() => {
      db.prepare(
        `UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, updated_at = datetime('now') WHERE user_id = ?`,
      ).run(user.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.user_id);
    });
    apply();

    return NextResponse.json({ success: true, data: { reset: true } });
  } catch (error) {
    console.error('Reset 2FA error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '2FA reset failed' } },
      { status: 500 },
    );
  }
}
