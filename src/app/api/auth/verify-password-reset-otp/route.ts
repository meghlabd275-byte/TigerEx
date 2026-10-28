import { NextRequest, NextResponse } from 'next/server';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { readJson } from '@/lib/security/otp-request';

/**
 * Verify a password-reset code.
 *
 * On success the code is consumed. The subsequent reset call re-checks that a
 * freshly verified code exists for the account.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const result = checkOtp('password_reset', body.emailOrPhone, body.code);
  if ('response' in result) return result.response;
  return NextResponse.json({ success: true, data: { verified: true } });
}
