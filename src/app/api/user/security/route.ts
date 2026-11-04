import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { securitySettings, updateSecuritySettings, AccountError } from '@/lib/security/account';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's security settings.
 *
 * Read from the account's own columns and updated only for the authenticated
 * user, so one account can never change another's flags.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json(
    { success: true, data: securitySettings(auth.user.userId) },
    { headers: NO_STORE },
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'user.security.update');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const settings = updateSecuritySettings(auth.user.userId, body);
    return NextResponse.json({ success: true, data: settings }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
