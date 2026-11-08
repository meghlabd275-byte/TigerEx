import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { loginHistory } from '@/lib/security/account';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's security log.
 *
 * Read from `login_attempts`, so both successful and failed sign-ins appear
 * with their IP and reason.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const events = loginHistory(auth.user.userId, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ success: true, logs: events, events, data: events }, { headers: NO_STORE });
}
