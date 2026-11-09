import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb, generateId } from '@/lib/db';

export interface AdminIdentity {
  adminId: string;
  email: string;
  role: string;
  permissions: string[];
}

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function parsePermissions(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve the authenticated administrator for a native admin route.
 *
 * Admin sessions live in `admin_sessions`, distinct from trader sessions, so
 * holding a trader token is never sufficient to reach an admin endpoint. There
 * is no anonymous fallback: a missing, unknown or expired token returns an
 * error response the caller must return.
 */
export async function requireAdmin(
  request: NextRequest,
): Promise<{ admin: AdminIdentity } | { error: NextResponse }> {
  const unauthorized = (code: string, message: string) =>
    NextResponse.json({ success: false, error: { code, message } }, { status: 401 });

  const token = readBearerToken(request);
  if (!token) return { error: unauthorized('UNAUTHORIZED', 'Administrator authorization required') };

  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.admin_id, a.email, a.role, a.permissions, a.status
         FROM admin_sessions s
         JOIN admin_users a ON s.admin_id = a.admin_id
        WHERE s.access_token = ? AND datetime(s.expires_at) > datetime('now')`,
    )
    .get(token) as
    | {
        admin_id: string;
        email: string;
        role: string;
        permissions: string | null;
        status: string;
      }
    | undefined;

  if (!row) return { error: unauthorized('INVALID_TOKEN', 'Invalid or expired administrator token') };
  if (row.status !== 'active') {
    return { error: unauthorized('ACCOUNT_DISABLED', 'This administrator account is not active') };
  }

  return {
    admin: {
      adminId: row.admin_id,
      email: row.email,
      role: row.role,
      permissions: parsePermissions(row.permissions),
    },
  };
}

/**
 * Verify an administrator's credentials and open a durable admin session.
 *
 * Returns null when the credentials are wrong, so the caller can respond
 * without revealing whether the address exists.
 */
export function authenticateAdmin(
  request: NextRequest,
  email: string,
  password: string,
): { accessToken: string; expiresAt: string; admin: AdminIdentity } | null {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const row = db
    .prepare('SELECT * FROM admin_users WHERE email = ?')
    .get(normalizedEmail) as
    | {
        admin_id: string;
        email: string;
        password_hash: string;
        role: string;
        permissions: string | null;
        status: string;
      }
    | undefined;

  if (!row || row.status !== 'active') return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;

  const accessToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO admin_sessions (session_id, admin_id, access_token, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    row.admin_id,
    accessToken,
    request.headers.get('x-forwarded-for') || 'unknown',
    request.headers.get('user-agent') || 'unknown',
    expiresAt,
  );

  db.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE admin_id = ?`).run(
    row.admin_id,
  );

  return {
    accessToken,
    expiresAt,
    admin: {
      adminId: row.admin_id,
      email: row.email,
      role: row.role,
      permissions: parsePermissions(row.permissions),
    },
  };
}

/** Revoke the session carried by the request. Returns whether a row was removed. */
export function revokeAdminSession(request: NextRequest): boolean {
  const token = readBearerToken(request);
  if (!token) return false;
  const result = getDb().prepare('DELETE FROM admin_sessions WHERE access_token = ?').run(token);
  return result.changes > 0;
}

/**
 * Append an entry to the immutable admin audit trail.
 *
 * The audit write is best-effort: a failure to record the trail must not be
 * swallowed by the caller, so this throws and the route surfaces the error
 * rather than reporting a mutation as both applied and unlogged.
 */
export function recordAdminAction(
  request: NextRequest,
  admin: AdminIdentity,
  action: string,
  target: { type?: string; id?: string; detail?: unknown } = {},
): void {
  getDb()
    .prepare(
      `INSERT INTO admin_audit_log
         (entry_id, admin_id, admin_email, action, target_type, target_id, detail, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      generateId(),
      admin.adminId,
      admin.email,
      action,
      target.type ?? null,
      target.id ?? null,
      target.detail === undefined ? null : JSON.stringify(target.detail),
      request.headers.get('x-forwarded-for') || 'unknown',
      request.headers.get('user-agent') || 'unknown',
    );
}
