import { NextRequest, NextResponse } from 'next/server';
import { rotateSession, RefreshError } from '@/lib/security/session-rotate';
import { enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Rotate an access token using a refresh token.
 *
 * Sessions are native to this venue, so the refresh token is looked up in the
 * `sessions` table rather than forwarded to an external backend. Rotation is
 * strict: the presented refresh token must belong to a session that has not
 * expired and whose account is active, and both tokens are replaced on
 * success, so a leaked refresh token is usable at most once.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.refresh', 30, 60_000);
  if (guard) return guard;

  let body: { refreshToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400, headers: NO_STORE },
    );
  }

  const refreshToken = String(body.refreshToken ?? '').trim();
  if (!refreshToken) {
    return NextResponse.json(
      { success: false, error: { code: 'MISSING_TOKEN', message: 'Refresh token required' } },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const tokens = rotateSession(refreshToken);
    return NextResponse.json({ success: true, ...tokens }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RefreshError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers: NO_STORE },
      );
    }
    console.error('Refresh token API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500, headers: NO_STORE },
    );
  }
}
