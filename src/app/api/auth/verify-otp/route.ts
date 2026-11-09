import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { readJson } from '@/lib/security/otp-request';
import { issueSession, SessionError } from '@/lib/security/session-issue';
import { decryptSecret, verifyTotp } from '@/lib/security/totp';
import { enforceRequestGuards } from '@/lib/api/route-guards';
import {
  requireLoginChallenge,
  recordChallengeFailure,
  consumeChallenge,
  ChallengeError,
} from '@/lib/security/login-challenge';

/**
 * Second-factor verification for an in-progress login.
 *
 * The login route hands the client a single-use challenge token when the
 * password is correct but 2FA is required. This route accepts either an
 * authenticator code (TOTP) or a delivered one-time code and issues a durable
 * session only after a code is confirmed. The challenge token is not a session
 * and grants nothing on its own.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.otp.verify', 10, 60_000);
  if (guard) return guard;
  const body = await readJson(request);
  const credential = String(body.credential ?? body.emailOrPhone ?? '').trim();
  const otp = String(body.otp ?? '').trim();
  const tempToken = String(body.tempToken ?? '').trim();

  if (!credential || !otp || !tempToken) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Credential, code and temporary token are required' } },
      { status: 400 },
    );
  }

  try {
    const challenge = requireLoginChallenge(tempToken);

    const db = getDb();
    const user = db
      .prepare('SELECT two_factor_secret, two_factor_enabled, email, phone FROM users WHERE user_id = ?')
      .get(challenge.userId) as
      | { two_factor_secret: string | null; two_factor_enabled: number; email: string | null; phone: string | null }
      | undefined;
    if (!user) {
      consumeChallenge(challenge.challengeId);
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 },
      );
    }

    // Authenticator (TOTP) path.
    let verified = false;
    if (user.two_factor_enabled && user.two_factor_secret) {
      try {
        verified = verifyTotp(decryptSecret(user.two_factor_secret), otp);
      } catch {
        verified = false;
      }
    }

    // Delivered one-time code path.
    if (!verified) {
      const delivered = checkOtp('login', credential, otp);
      verified = !('response' in delivered);
    }

    if (!verified) {
      recordChallengeFailure(challenge.challengeId);
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CODE', message: 'Invalid verification code' } },
        { status: 400 },
      );
    }

    // Consume the challenge and issue a durable session.
    consumeChallenge(challenge.challengeId);
    const full = issueSession(request, challenge.userId);

    return NextResponse.json({
      success: true,
      accessToken: full.accessToken,
      refreshToken: full.refreshToken,
      expiresIn: 86400,
      user: full.user,
    });
  } catch (error) {
    if (error instanceof ChallengeError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof SessionError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    console.error('Verify OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 },
    );
  }
}
