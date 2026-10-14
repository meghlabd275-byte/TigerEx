import { NextResponse } from 'next/server';

// Verification must be performed by the authenticated backend using a durable,
// rate-limited challenge store. A process-local map is unsafe across replicas.
export async function POST() {
  return NextResponse.json({ success: false, error: { code: 'OTP_PROVIDER_UNAVAILABLE', message: 'Email verification is unavailable until the authenticated backend and persistent challenge store are configured.' } }, { status: 503 });
}
