import { NextRequest, NextResponse } from 'next/server';
import { parseDestination, readJson, sendOtpToExistingUser } from '@/lib/security/otp-request';

export async function POST(request: NextRequest) {
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
