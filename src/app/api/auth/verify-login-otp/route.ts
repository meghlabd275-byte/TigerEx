import { NextRequest, NextResponse } from 'next/server';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { readJson } from '@/lib/security/otp-request';
import { issueSession, SessionError } from '@/lib/security/session-issue';
import { enforceRequestGuards } from '@/lib/api/route-guards';

/**
 * Complete an OTP login.
 *
 * Verifies the emailed/texted code, then creates a durable session. The session
 * is only issued after the code is confirmed, so no token exists before the
 * second factor is satisfied.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.otp.verify', 10, 60_000);
  if (guard) return guard;
  const body = await readJson(request);
  const result = checkOtp('login', body.emailOrPhone, body.code);
  if ('response' in result) return result.response;

  try {
    if (!result.userId) {
      return NextResponse.json(
        { success: false, error: { code: 'NO_ACCOUNT', message: 'No account is associated with that code' } },
        { status: 400 },
      );
    }

    const session = issueSession(request, result.userId, {
      trustedDevice: body.trustedDevice === true,
    });

    return NextResponse.json({
      success: true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: 86400,
      user: session.user,
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    console.error('Verify login OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 },
    );
  }
}
