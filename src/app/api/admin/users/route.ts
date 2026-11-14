import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * List exchange users with their verification level and account state.
 *
 * Read from the exchange's own `users` table. Password hashes and two-factor
 * secrets are never selected, so they cannot leak through this route.
 */

function toUnixSeconds(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0;
  const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 50) || 50, 1), 500);
  const offset = Math.max(Number(searchParams.get('offset') ?? 0) || 0, 0);
  const search = searchParams.get('search')?.trim();

  const db = getDb();
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (search) {
    clauses.push('(email LIKE ? OR username LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM users${where}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT user_id, email, username, display_name, kyc_level, kyc_status, status,
              two_factor_enabled, email_verified, phone_verified, created_at, last_login_at
         FROM users${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      total,
      users: rows.map((row) => ({
        id: row.user_id,
        email: row.email,
        username: row.username ?? row.display_name ?? '',
        kycLevel: Number(row.kyc_level === 'none' ? 0 : row.kyc_level) || 0,
        kycStatus: row.kyc_status ?? 'none',
        isAdmin: false,
        twoFactorEnabled: row.two_factor_enabled === 1,
        emailVerified: row.email_verified === 1,
        phoneVerified: row.phone_verified === 1,
        locked: row.status === 'locked' || row.status === 'suspended',
        createdAt: toUnixSeconds(row.created_at),
        lastLoginAt: toUnixSeconds(row.last_login_at),
      })),
    },
    { headers: NO_STORE },
  );
}
