import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { deletionRequested } from '@/lib/security/account-deletion';
import { fail, NO_STORE } from '@/lib/api/route-guards';

/**
 * Account deletion.
 *
 * Deletion is not a single request: a code must first be verified through
 * `/api/settings/verify-deletion-otp`. This endpoint therefore never deletes on
 * a bare call. It reports whether a verified request is already on file, and
 * refuses to act otherwise, so a stolen session alone cannot delete an account.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  if (!deletionRequested(auth.user.userId)) {
    return fail(
      'VERIFICATION_REQUIRED',
      'Request a deletion code and verify it before the account can be deleted',
      403,
    );
  }

  return NextResponse.json(
    { success: true, status: 'pending_deletion' },
    { headers: NO_STORE },
  );
}
