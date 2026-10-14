import { NextResponse } from 'next/server';

// Account deletion requires an authenticated backend challenge, durable storage,
// replay protection, and an auditable durable state transition.
export async function POST() {
  return NextResponse.json({ success: false, error: { code: 'OTP_PROVIDER_UNAVAILABLE', message: 'Account deletion verification is unavailable until the authenticated backend and persistent challenge store are configured.' } }, { status: 503 });
}
