import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { readJson, fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { beginEmailChange, EmailChangeError } from '@/lib/security/email-change';

/**
 * Start an email change: send a code to the address currently on the account.
 *
 * The address is checked against the account rather than trusted from the body,
 * so a code can only ever go to the address the exchange has on file.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'email-change', 5, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON body is required');

  try {
    await beginEmailChange(auth.user.userId, body.currentEmail);
    return NextResponse.json({ success: true, data: { sent: true } }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmailChangeError) return fail(error.code, error.message, error.status);
    return fail('DELIVERY_FAILED', 'The verification code could not be sent', 503);
  }
}
