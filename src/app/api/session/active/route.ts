import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listSessions } from '@/lib/security/account';
import { NO_STORE } from '@/lib/api/route-guards';

function bearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** The caller's active sessions, with the current one marked. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const sessions = listSessions(auth.user.userId, bearer(request));
  return NextResponse.json({ success: true, sessions, data: sessions }, { headers: NO_STORE });
}
