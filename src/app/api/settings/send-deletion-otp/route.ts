import { NextResponse } from 'next/server';

// OTP delivery requires a durable challenge store, rate limiting, and a verified
// email/SMS provider. Never log or return a generated OTP as if it were delivered.
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'OTP_PROVIDER_UNAVAILABLE',
        message: 'OTP delivery is unavailable until a verified delivery provider and persistent challenge store are configured.',
      },
    },
    { status: 503 },
  );
}
