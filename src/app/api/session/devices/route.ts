import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listSessions } from '@/lib/security/account';
import { NO_STORE } from '@/lib/api/route-guards';

function bearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/**
 * The caller's signed-in devices.
 *
 * A device is a session with its user agent and IP; the same rows the session
 * console revokes, so a device shown here can be signed out from there.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const devices = listSessions(auth.user.userId, bearer(request)).map((session) => ({
    id: session.id,
    deviceId: session.device_id,
    userAgent: session.user_agent,
    ipAddress: session.ip_address,
    createdAt: session.created_at,
    lastActiveAt: session.last_active_at,
    expiresAt: session.expires_at,
    trusted: session.trusted,
    current: session.current,
  }));

  return NextResponse.json({ success: true, devices, data: devices }, { headers: NO_STORE });
}
