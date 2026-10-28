import { NextResponse } from 'next/server';
import { verifyOtp, type OtpPurpose, type VerifyResult } from '@/lib/security/otp';
import { parseDestination, type ParsedDestination } from '@/lib/security/otp-request';

const REASON_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'No verification code is pending for this account',
  EXPIRED: 'Verification code has expired',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Request a new code.',
  MISMATCH: 'Invalid verification code',
};

export interface VerifiedOtp {
  ok: true;
  userId: string | null;
  destination: ParsedDestination;
}

export interface FailedOtp {
  ok: false;
  response: NextResponse;
}

/**
 * Verify a submitted code against durable storage.
 *
 * Shared by every OTP-consuming route so the expiry, attempt-limit and
 * single-use rules are identical everywhere.
 */
export function checkOtp(
  purpose: OtpPurpose,
  emailOrPhone: unknown,
  code: unknown,
): VerifiedOtp | FailedOtp {
  const destination = parseDestination(emailOrPhone);
  const submitted = String(code ?? '').trim();
  if (!destination || !/^\d{6}$/.test(submitted)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'A valid destination and 6-digit code are required' } },
        { status: 400 },
      ),
    };
  }

  const result: VerifyResult = verifyOtp(purpose, destination, submitted);
  if (!result.ok) {
    const reason = result.reason ?? 'MISMATCH';
    const status = reason === 'TOO_MANY_ATTEMPTS' ? 429 : 400;
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: { code: reason, message: REASON_MESSAGES[reason] } },
        { status },
      ),
    };
  }

  return { ok: true, userId: result.userId ?? null, destination };
}
