import { NextResponse } from 'next/server';

// Account deletion must be executed by the authenticated backend with OTP/MFA
// verification, custody checks, retention policy handling, and audit logging.
export async function POST() {
  return NextResponse.json({ success: false, error: { code: 'ACCOUNT_DELETION_UNAVAILABLE', message: 'Account deletion is unavailable until the authenticated backend deletion workflow is configured.' } }, { status: 503 });
}
