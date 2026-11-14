import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { parseJsonColumn, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Roles and administrators for the permissions console.
 *
 * Administrators are read from `admin_users`; their stored permissions are the
 * source of truth. Password hashes and two-factor secrets are never selected.
 */

/** The permission catalogue the console offers, grouped by area. */
const PERMISSION_CATALOGUE: Array<{ role: string; permissions: string[] }> = [
  { role: 'super_admin', permissions: ['all'] },
  {
    role: 'admin',
    permissions: [
      'users.read', 'users.write', 'kyc.read', 'kyc.write',
      'markets.read', 'markets.write', 'fees.read', 'fees.write',
      'withdrawals.read', 'withdrawals.write', 'audit.read',
    ],
  },
  {
    role: 'support',
    permissions: ['users.read', 'kyc.read', 'audit.read', 'support.read', 'support.write'],
  },
  { role: 'analyst', permissions: ['users.read', 'markets.read', 'audit.read', 'analytics.read'] },
];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rows = getDb()
    .prepare('SELECT admin_id, email, username, role, permissions, status FROM admin_users ORDER BY created_at')
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      data: {
        roles: PERMISSION_CATALOGUE,
        admins: rows.map((row) => ({
          id: row.admin_id,
          email: row.email,
          username: row.username ?? '',
          role: row.role,
          status: row.status ?? 'active',
          permissions: parseJsonColumn<string[]>(row.permissions, []),
        })),
      },
    },
    { headers: NO_STORE },
  );
}
