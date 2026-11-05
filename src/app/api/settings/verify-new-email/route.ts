import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { readJson, fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { verifyNewEmail, EmailChangeError } from '@/lib/security/email-change';

/** Confirm the code sent to the address the account is moving to. */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'email-change-verify-new', 10, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON body is required');

  try {
    verifyNewEmail(auth.user.userId, body.email, body.code);
    return NextResponse.json({ success: true, data: { verified: true } }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmailChangeError) return fail(error.code, error.message, error.status);
    return fail('VERIFICATION_FAILED', 'The code could not be verified');
  }
}
