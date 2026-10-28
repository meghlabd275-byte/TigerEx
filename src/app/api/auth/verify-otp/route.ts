import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { readJson } from '@/lib/security/otp-request';
import { issueSession } from '@/lib/security/session-issue';
import { decryptSecret, verifyTotp } from '@/lib/security/totp';

/**
 * Second-factor verification for an in-progress login.
 *
 * A temporary session is created by the login route when the password is
 * correct but 2FA is required. This route accepts either an authenticator code
 * (TOTP) or a delivered one-time code, and promotes the temporary session to a
 * full session only after a code is confirmed.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const credential = String(body.credential ?? '').trim();
  const otp = String(body.otp ?? '').trim();
  const tempToken = String(body.tempToken ?? '').trim();

  if (!credential || !otp || !tempToken) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Credential, code and temporary token are required' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const session = db
      .prepare(
        `SELECT session_id, user_id FROM sessions WHERE access_token = ? AND expires_at > datetime('now')`,
      )
      .get(tempToken) as { session_id: string; user_id: string } | undefined;

    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: 'SESSION_EXPIRED', message: 'Login session has expired. Sign in again.' } },
        { status: 400 },
      );
    }

    const user = db
      .prepare('SELECT two_factor_secret, two_factor_enabled, email, phone FROM users WHERE user_id = ?')
      .get(session.user_id) as
      | { two_factor_secret: string | null; two_factor_enabled: number; email: string | null; phone: string | null }
      | undefined;
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 },
      );
    }

    // Authenticator (TOTP) path.
    let totpOk = false;
    if (user.two_factor_enabled && user.two_factor_secret) {
      try {
        totpOk = verifyTotp(decryptSecret(user.two_factor_secret), otp);
      } catch {
        totpOk = false;
      }
    }

    // Delivered one-time code path.
    if (!totpOk) {
      const delivered = checkOtp('login', credential, otp);
      if ('response' in delivered) {
        return delivered.response;
      }
    }

    // Consume the temporary session and issue a full one.
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(session.session_id);
    const full = issueSession(request, session.user_id);

    return NextResponse.json({
      success: true,
      accessToken: full.accessToken,
      refreshToken: full.refreshToken,
      expiresIn: 86400,
      user: full.user,
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 },
    );
  }
}
