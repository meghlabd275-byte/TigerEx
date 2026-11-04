import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listSessions, revokeSession, revokeOtherSessions, AccountError } from '@/lib/security/account';
import { fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's active sessions.
 *
 * A device can be signed out individually, or all other devices at once. The
 * session used for the current request is marked and cannot revoke itself, so
 * the console cannot lock the operator out of the page they are on.
 */
function bearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const sessions = listSessions(auth.user.userId, bearer(request));
  return NextResponse.json({ success: true, sessions, data: sessions }, { headers: NO_STORE });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'user.sessions.revoke');
  if (guard) return guard;

  const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
  if (!sessionId) return fail('VALIDATION_FAILED', 'A sessionId is required');

  try {
    revokeSession(auth.user.userId, sessionId, bearer(request));
    return NextResponse.json({ success: true, sessionId }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

/** Sign out every other device. */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'user.sessions.revokeAll');
  if (guard) return guard;

  const revoked = revokeOtherSessions(auth.user.userId, bearer(request));
  return NextResponse.json({ success: true, revoked }, { headers: NO_STORE });
}
