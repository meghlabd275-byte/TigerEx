import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, parseJsonColumn, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * White-label clients.
 *
 * A client is an exchange deployment run under another brand. Its domain must be
 * a fully qualified name (it is used to route incoming requests), and its slug
 * is derived once from the domain or the name. Records live in the exchange's
 * own database, so a self-contained deployment needs no external service.
 */

const STATUSES = ['active', 'pending', 'suspended'];

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status')?.trim();
  const clauses: string[] = [];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM white_label_clients${where} ORDER BY created_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      clients: rows.map((row) => ({
        id: row.client_id,
        name: row.name,
        domain: row.domain ?? null,
        branding: parseJsonColumn<Record<string, unknown>>(row.branding, {}),
        status: row.status,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Register a white-label client. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.white-label');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > 120) return fail('VALIDATION_FAILED', 'name is required and must be at most 120 characters');

  const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  if (domain.length > 0 && (domain.length > 253 || !DOMAIN_RE.test(domain))) {
    return fail('VALIDATION_FAILED', 'domain must be a fully qualified domain name');
  }

  const branding = body.branding && typeof body.branding === 'object' && !Array.isArray(body.branding) ? body.branding : {};
  const status = String(body.status ?? 'pending').toLowerCase();
  if (!STATUSES.includes(status)) return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);

  const db = getDb();
  if (domain && db.prepare('SELECT 1 FROM white_label_clients WHERE domain = ?').get(domain)) {
    return fail('DUPLICATE_DOMAIN', 'A client already uses that domain', 409);
  }

  const clientId = generateId();
  db.prepare(
    `INSERT INTO white_label_clients (client_id, name, domain, branding, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(clientId, name, domain || null, JSON.stringify(branding), status);

  recordAdminAction(request, auth.admin, 'white_label.create', {
    type: 'white_label_client',
    id: clientId,
    detail: { name, domain, status },
  });

  return NextResponse.json({ success: true, clientId, name, domain, status }, { status: 201, headers: NO_STORE });
}

/** Update a client's name, domain, branding or status. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.white-label.update');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clientId)) return fail('VALIDATION_FAILED', 'Invalid client id');

  const db = getDb();
  const existing = db.prepare('SELECT * FROM white_label_clients WHERE client_id = ?').get(clientId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return fail('UNKNOWN_CLIENT', 'No such client', 404);

  const name = body.name === undefined ? String(existing.name) : String(body.name).trim();
  if (name.length === 0 || name.length > 120) return fail('VALIDATION_FAILED', 'name must be between 1 and 120 characters');

  const domain = body.domain === undefined ? (existing.domain as string | null) ?? '' : String(body.domain).trim().toLowerCase();
  if (domain.length > 0 && !DOMAIN_RE.test(domain)) {
    return fail('VALIDATION_FAILED', 'domain must be a fully qualified domain name');
  }
  if (domain && domain !== existing.domain && db.prepare('SELECT 1 FROM white_label_clients WHERE domain = ?').get(domain)) {
    return fail('DUPLICATE_DOMAIN', 'A client already uses that domain', 409);
  }

  const branding =
    body.branding === undefined
      ? (existing.branding as string | null)
      : JSON.stringify(body.branding && typeof body.branding === 'object' ? body.branding : {});

  const status = body.status === undefined ? String(existing.status) : String(body.status).toLowerCase();
  if (!STATUSES.includes(status)) return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);

  db.prepare(
    'UPDATE white_label_clients SET name = ?, domain = ?, branding = ?, status = ? WHERE client_id = ?',
  ).run(name, domain || null, branding, status, clientId);

  recordAdminAction(request, auth.admin, 'white_label.update', {
    type: 'white_label_client',
    id: clientId,
    detail: { name, domain, status },
  });

  return NextResponse.json({ success: true, clientId }, { headers: NO_STORE });
}

/** Delete a white-label client. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.white-label.delete');
  if (guard) return guard;

  const clientId = request.nextUrl.searchParams.get('clientId')?.trim();
  if (!clientId || !/^[A-Za-z0-9_-]{1,64}$/.test(clientId)) {
    return fail('VALIDATION_FAILED', 'clientId query parameter is required');
  }

  const result = getDb().prepare('DELETE FROM white_label_clients WHERE client_id = ?').run(clientId);
  if (result.changes === 0) return fail('UNKNOWN_CLIENT', 'No such client', 404);

  recordAdminAction(request, auth.admin, 'white_label.delete', { type: 'white_label_client', id: clientId });
  return NextResponse.json({ success: true, clientId }, { headers: NO_STORE });
}
