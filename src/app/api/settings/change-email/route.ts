import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { readJson, fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { completeEmailChange, EmailChangeError } from '@/lib/security/email-change';

/**
 * Commit an email change.
 *
 * Both addresses must have been verified in the last 15 minutes. The update and
 * the revocation of every other session run in one transaction, so a change can
 * never leave a stolen session alive on the old address.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'email-change-commit', 5, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON body is required');

  const token = request.headers.get('authorization')?.slice(7).trim() ?? null;

  try {
    const result = completeEmailChange(auth.user.userId, body.currentEmail, body.newEmail, token);
    return NextResponse.json({ success: true, data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmailChangeError) return fail(error.code, error.message, error.status);
    return fail('EMAIL_CHANGE_FAILED', 'The email address could not be changed');
  }
}
