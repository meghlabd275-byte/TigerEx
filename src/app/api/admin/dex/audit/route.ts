import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The DEX audit trail.
 *
 * Reads the append-only `admin_audit_log` for the actions the DEX admin routes
 * record. Nothing updates or deletes it; this route only reads.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 200), 1), 1000);
  const rows = getDb()
    .prepare(
      `SELECT entry_id, admin_id, admin_email, action, target_type, target_id, detail, created_at
         FROM admin_audit_log
        WHERE action LIKE 'dex.%'
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      entries: rows.map((row) => ({
        entryId: row.entry_id,
        adminId: row.admin_id,
        adminEmail: row.admin_email,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail: row.detail ? JSON.parse(String(row.detail)) : null,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}
