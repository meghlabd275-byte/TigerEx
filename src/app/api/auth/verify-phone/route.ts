import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { readJson } from '@/lib/security/otp-request';

/** Verify a phone number with the registration code sent to it. */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const result = checkOtp('register', body.phone ?? body.emailOrPhone, body.code);
  if ('response' in result) return result.response;

  try {
    const db = getDb();
    db.prepare(
      `UPDATE users SET phone_verified = 1, updated_at = datetime('now') WHERE phone = ?`,
    ).run(result.destination.phone);
    return NextResponse.json({ success: true, data: { verified: true } });
  } catch (error) {
    console.error('Verify phone error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 },
    );
  }
}
