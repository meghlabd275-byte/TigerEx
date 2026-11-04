import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { loginHistory } from '@/lib/security/account';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's recent sign-in attempts.
 *
 * Read from `login_attempts`, so a failed attempt is shown as well as a
 * successful one.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const events = loginHistory(auth.user.userId, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ success: true, history: events, data: events }, { headers: NO_STORE });
}
