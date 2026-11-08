import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { confirmDeletion, DeletionError } from '@/lib/security/account-deletion';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Verify a deletion code and schedule the deletion.
 *
 * The account must have no balance and no open orders; a request that would
 * strand funds is refused with the offending assets so the user can withdraw
 * first. On success every session is revoked.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'settings.deletion.verify', 5, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const code = String(body.code ?? body.otp ?? '').trim();

  try {
    const result = confirmDeletion(auth.user.userId, code);
    return NextResponse.json({ success: true, result, data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof DeletionError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
