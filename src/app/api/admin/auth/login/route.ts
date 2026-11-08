import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin, recordAdminAction } from '@/lib/auth/admin';
import { enforceRequestGuards } from '@/lib/api/route-guards';

/**
 * Administrator sign-in.
 *
 * Credentials are verified against `admin_users` (bcrypt) and a session row is
 * written to `admin_sessions`. A failure always returns the same 401 body, so
 * the response does not disclose whether the address exists.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'admin.login', 10, 60_000);
  if (guard) return guard;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'A JSON body is required' } },
      { status: 400 },
    );
  }

  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email and password are required' } },
      { status: 400 },
    );
  }

  const result = authenticateAdmin(request, email, password);
  if (!result) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  recordAdminAction(request, result.admin, 'admin.login', { type: 'admin', id: result.admin.adminId });

  return NextResponse.json(
    {
      success: true,
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      admin: {
        adminId: result.admin.adminId,
        email: result.admin.email,
        role: result.admin.role,
        permissions: result.admin.permissions,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
