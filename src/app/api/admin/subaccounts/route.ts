import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, parseJsonColumn, NO_STORE } from '@/lib/api/route-guards';

/**
 * Sub-account administration.
 *
 * A sub-account belongs to a parent user and has its own label, permissions and
 * status. Sub-accounts are how a team or trading firm keeps balances and API
 * keys isolated under one parent.
 */

const STATUSES = ['active', 'frozen', 'closed'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const parentUserId = request.nextUrl.searchParams.get('parentUserId')?.trim();
  const clauses: string[] = [];
  const params: string[] = [];
  if (parentUserId) {
    clauses.push('parent_user_id = ?');
    params.push(parentUserId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM subaccounts${where} ORDER BY created_at DESC LIMIT 1000`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      subaccounts: rows.map((row) => ({
        subaccountId: row.subaccount_id,
        parentUserId: row.parent_user_id,
        email: row.email,
        label: row.label ?? null,
        permissions: parseJsonColumn<string[]>(row.permissions, []),
        status: row.status,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Create a sub-account under a parent user. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.subaccounts');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const parentUserId = typeof body.parentUserId === 'string' ? body.parentUserId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(parentUserId)) return fail('VALIDATION_FAILED', 'Invalid parent user id');

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return fail('VALIDATION_FAILED', 'A valid sub-account email is required');
  }

  const label = body.label === undefined || body.label === null ? null : String(body.label).trim().slice(0, 120);
  const permissions = Array.isArray(body.permissions) ? body.permissions.map(String).slice(0, 100) : [];

  const db = getDb();
  const parent = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(parentUserId);
  if (!parent) return fail('UNKNOWN_USER', 'No such parent user', 404);

  if (db.prepare('SELECT 1 FROM subaccounts WHERE parent_user_id = ? AND email = ?').get(parentUserId, email)) {
    return fail('DUPLICATE_SUBACCOUNT', 'This parent already has a sub-account with that email', 409);
  }

  const count = (db.prepare('SELECT COUNT(*) AS n FROM subaccounts WHERE parent_user_id = ?').get(parentUserId) as { n: number }).n;
  if (count >= 300) return fail('SUBCACCOUNT_LIMIT', 'A parent may hold at most 300 sub-accounts', 409);

  const subaccountId = generateId();
  db.prepare(
    `INSERT INTO subaccounts (subaccount_id, parent_user_id, email, label, permissions, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  ).run(subaccountId, parentUserId, email, label, JSON.stringify(permissions));

  recordAdminAction(request, auth.admin, 'subaccount.create', {
    type: 'subaccount',
    id: subaccountId,
    detail: { parentUserId, email, label, permissions },
  });

  return NextResponse.json({ success: true, subaccountId, email }, { status: 201, headers: NO_STORE });
}

/** Change a sub-account's status or permissions. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.subaccounts.update');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const subaccountId = typeof body.subaccountId === 'string' ? body.subaccountId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(subaccountId)) return fail('VALIDATION_FAILED', 'Invalid sub-account id');

  const status = body.status === undefined ? null : String(body.status).toLowerCase();
  if (status !== null && !STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  const permissions = body.permissions === undefined ? null : Array.isArray(body.permissions) ? body.permissions.map(String).slice(0, 100) : undefined;
  if (permissions === undefined) return fail('VALIDATION_FAILED', 'permissions must be an array when supplied');

  const db = getDb();
  const existing = db.prepare('SELECT status FROM subaccounts WHERE subaccount_id = ?').get(subaccountId) as
    | { status: string }
    | undefined;
  if (!existing) return fail('UNKNOWN_SUBACCOUNT', 'No such sub-account', 404);

  db.prepare(
    `UPDATE subaccounts
        SET status = COALESCE(?, status), permissions = COALESCE(?, permissions)
      WHERE subaccount_id = ?`,
  ).run(status, permissions === null ? null : JSON.stringify(permissions), subaccountId);

  recordAdminAction(request, auth.admin, 'subaccount.update', {
    type: 'subaccount',
    id: subaccountId,
    detail: { from: existing.status, status, permissions },
  });

  return NextResponse.json({ success: true, subaccountId, status: status ?? existing.status }, { headers: NO_STORE });
}
