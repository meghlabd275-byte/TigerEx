import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { parseJsonColumn, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Registered API keys.
 *
 * Secret material is never returned: only the key id, its name, its permission
 * set, its IP allowlist and its lifecycle timestamps. The stored hash is not
 * selected at all, so it cannot leak through this route.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 100) || 100, 1), 500);
  const offset = Math.max(Number(searchParams.get('offset') ?? 0) || 0, 0);
  const userId = searchParams.get('userId')?.trim();

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (userId) {
    clauses.push('user_id = ?');
    params.push(userId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(
      `SELECT key_id, user_id, name, permissions, ip_whitelist, enabled, last_used_at, expires_at, created_at
         FROM api_keys${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      data: rows.map((row) => ({
        id: row.key_id,
        userId: row.user_id,
        name: row.name,
        permissions: parseJsonColumn<string[]>(row.permissions, []),
        ipWhitelist: parseJsonColumn<string[]>(row.ip_whitelist, []),
        enabled: row.enabled === 1,
        lastUsedAt: row.last_used_at ?? null,
        expiresAt: row.expires_at ?? null,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}
