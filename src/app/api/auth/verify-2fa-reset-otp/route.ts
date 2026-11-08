import { NextRequest, NextResponse } from 'next/server';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { readJson } from '@/lib/security/otp-request';
import { enforceRequestGuards } from '@/lib/api/route-guards';

/**
 * Verify the code sent to begin a 2FA reset.
 *
 * Confirms the code against durable storage so the subsequent reset call can
 * check that a freshly verified 2fa_reset code exists for the account.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.otp.verify', 10, 60_000);
  if (guard) return guard;
  const body = await readJson(request);
  const result = checkOtp('2fa_reset', body.emailOrPhone, body.code);
  if ('response' in result) return result.response;
  return NextResponse.json({ success: true, data: { verified: true } });
}
