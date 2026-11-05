import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { readJson, fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { verifyOtp } from '@/lib/security/otp';

/**
 * Confirm an identity-verification code.
 *
 * The code is checked against the account's own email or phone, so a verified
 * flag can only ever be raised for an address the caller controls.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'kyc-identity-verify', 10, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON body is required');
  const code = String(body.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) return fail('VALIDATION_FAILED', 'A six-digit code is required');

  const byEmail = auth.user.email
    ? verifyOtp('email_verify', { email: auth.user.email }, code)
    : { ok: false as const, reason: 'NOT_FOUND' as const };
  if (byEmail.ok) {
    return NextResponse.json({ success: true, data: { verified: true } }, { headers: NO_STORE });
  }

  const byPhone = auth.user.phone
    ? verifyOtp('phone_verify', { phone: auth.user.phone }, code)
    : { ok: false as const, reason: 'NOT_FOUND' as const };
  if (byPhone.ok) {
    return NextResponse.json({ success: true, data: { verified: true } }, { headers: NO_STORE });
  }

  const reason = byEmail.reason === 'TOO_MANY_ATTEMPTS' || byPhone.reason === 'TOO_MANY_ATTEMPTS'
    ? 'TOO_MANY_ATTEMPTS'
    : 'INVALID_CODE';
  return fail(reason, 'The verification code is not valid', reason === 'TOO_MANY_ATTEMPTS' ? 429 : 400);
}
