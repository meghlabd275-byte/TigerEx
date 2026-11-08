import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listSessions, revokeSession, AccountError } from '@/lib/security/account';
import { fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

function bearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** The caller's signed-in devices; DELETE signs one out. Alias of `/api/user/devices`. */
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

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'device.manage.revoke');
  if (guard) return guard;

  const deviceId = request.nextUrl.searchParams.get('deviceId')?.trim();
  if (!deviceId) return fail('VALIDATION_FAILED', 'A deviceId is required');

  try {
    revokeSession(auth.user.userId, deviceId, bearer(request));
    return NextResponse.json({ success: true, deviceId }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
