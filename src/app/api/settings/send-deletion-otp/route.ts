import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { requestDeletion, DeletionError } from '@/lib/security/account-deletion';
import { fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Send an account-deletion verification code.
 *
 * The code goes to the address on file through the configured transport and is
 * never returned. When delivery is not configured the request fails closed with
 * `DELIVERY_FAILED` rather than pretending a code was sent.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'settings.deletion.otp', 5, 60_000);
  if (guard) return guard;

  try {
    await requestDeletion(auth.user.userId);
    return NextResponse.json({ success: true, data: { sent: true } }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof DeletionError) return fail(error.code, error.message, error.status);
    return fail('DELIVERY_FAILED', 'The verification code could not be sent', 503);
  }
}
