import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { readJson, fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { sendNewEmailCode, EmailChangeError } from '@/lib/security/email-change';

/**
 * Send a code to the address the account is moving to.
 *
 * Refused when the address is already in use, so the flow cannot be used to
 * probe whether an address is registered without an attempt being rejected.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'email-change-new', 5, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON body is required');

  try {
    await sendNewEmailCode(auth.user.userId, body.email);
    return NextResponse.json({ success: true, data: { sent: true } }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmailChangeError) return fail(error.code, error.message, error.status);
    return fail('DELIVERY_FAILED', 'The verification code could not be sent', 503);
  }
}
