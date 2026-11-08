import { NextRequest, NextResponse } from 'next/server';
import { parseDestination, readJson, sendOtpToExistingUser } from '@/lib/security/otp-request';
import { enforceRequestGuards } from '@/lib/api/route-guards';

export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.otp.send', 5, 60_000);
  if (guard) return guard;
  const body = await readJson(request);
  const destination = parseDestination(body.emailOrPhone);
  if (!destination) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'A valid email or phone number is required' } },
      { status: 400 },
    );
  }
  return sendOtpToExistingUser('password_reset', destination);
}
