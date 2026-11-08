import { NextRequest, NextResponse } from 'next/server';
import { revokeAdminSession, recordAdminAction, requireAdmin } from '@/lib/auth/admin';

/**
 * Administrator sign-out.
 *
 * The session row carrying the presented token is deleted, so the token can no
 * longer reach an admin route. The caller is resolved first so the sign-out is
 * attributed in the audit trail.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  revokeAdminSession(request);
  recordAdminAction(request, auth.admin, 'admin.logout', { type: 'admin', id: auth.admin.adminId });

  return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
}
