import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { readJson } from '@/lib/security/otp-request';

/**
 * Confirm a registration code.
 *
 * Marks the corresponding email or phone as verified on the account so the
 * verified flag the register route checks is grounded in a real code exchange.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const result = checkOtp('register', body.emailOrPhone, body.code);
  if ('response' in result) return result.response;

  try {
    const db = getDb();
    if (result.destination.email) {
      db.prepare(
        `UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE email = ?`,
      ).run(result.destination.email);
    } else if (result.destination.phone) {
      db.prepare(
        `UPDATE users SET phone_verified = 1, updated_at = datetime('now') WHERE phone = ?`,
      ).run(result.destination.phone);
    }
    return NextResponse.json({ success: true, data: { verified: true } });
  } catch (error) {
    console.error('Verify register OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 },
    );
  }
}
