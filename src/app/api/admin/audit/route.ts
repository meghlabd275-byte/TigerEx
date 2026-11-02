import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

/**
 * The immutable admin audit trail.
 *
 * Read-only: entries are appended by the routes that perform administrative
 * mutations and are never updated or deleted through the API. The durable
 * admin backend is used when configured; otherwise the local trail is served.
 */
const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Administrator authorization required' } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 100) || 100, 1), 1000);
  const action = searchParams.get('action');
  const adminId = searchParams.get('adminId');

  // When a durable admin backend is configured it is the system of record.
  if (ADMIN_API_URL) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (action) query.set('action', action);
    if (adminId) query.set('adminId', adminId);
    try {
      const upstream = await fetch(`${ADMIN_API_URL}/audit?${query}`, {
        headers: { Accept: 'application/json', Authorization: token },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const payload = await upstream.json().catch(() => ({
        success: false,
        error: 'Invalid admin backend response',
      }));
      return NextResponse.json(payload, { status: upstream.status });
    } catch {
      return NextResponse.json(
        { success: false, error: 'Admin backend is unavailable; audit logs could not be loaded.' },
        { status: 502 },
      );
    }
  }

  // Local trail. The session must still be a valid admin session.
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (action) {
    clauses.push('action = ?');
    params.push(action);
  }
  if (adminId) {
    clauses.push('admin_id = ?');
    params.push(adminId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);

  const rows = getDb()
    .prepare(
      `SELECT entry_id, admin_id, admin_email, action, target_type, target_id,
              detail, ip_address, user_agent, created_at
         FROM admin_audit_log${where}
        ORDER BY created_at DESC, entry_id DESC
        LIMIT ?`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      logs: rows.map((row) => ({
        entryId: row.entry_id,
        adminId: row.admin_id,
        adminEmail: row.admin_email,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail: row.detail,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
