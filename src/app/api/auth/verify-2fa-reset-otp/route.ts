import { NextRequest, NextResponse } from 'next/server';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { readJson } from '@/lib/security/otp-request';

/**
 * Verify the code sent to begin a 2FA reset.
 *
 * Confirms the code against durable storage so the subsequent reset call can
 * check that a freshly verified 2fa_reset code exists for the account.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const result = checkOtp('2fa_reset', body.emailOrPhone, body.code);
  if ('response' in result) return result.response;
  return NextResponse.json({ success: true, data: { verified: true } });
}
