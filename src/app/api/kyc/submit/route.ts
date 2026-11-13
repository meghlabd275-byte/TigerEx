import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { readJson, fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { submitApplication, KycError } from '@/lib/kyc/submission';

/**
 * Submit a KYC application.
 *
 * Document images arrive base64-encoded in the JSON body and are encrypted
 * before they are stored. The application is held for a human reviewer; this
 * route never approves it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'kyc-submit', 5, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON body is required');

  try {
    const result = submitApplication(auth.user.userId, {
      personalInfo: body.personalInfo,
      documentType: body.documentType,
      documents: body.documents,
      mrz: body.mrz,
    });
    return NextResponse.json({ success: true, data: result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof KycError) return fail(error.code, error.message, error.status);
    return fail('KYC_SUBMIT_FAILED', 'The application could not be recorded', 500);
  }
}
