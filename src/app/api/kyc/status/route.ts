import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { fail, NO_STORE } from '@/lib/api/route-guards';
import { applicationStatus, KycError } from '@/lib/kyc/submission';

/** The authenticated applicant's own KYC state. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    return NextResponse.json({ success: true, data: applicationStatus(auth.user.userId) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof KycError) return fail(error.code, error.message, error.status);
    return fail('KYC_STATUS_FAILED', 'The KYC status could not be read', 500);
  }
}
