import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE } from '@/lib/api/route-guards';

/**
 * DEX emergency controls: pausing the venue or a scope, and the blacklist.
 *
 * Pausing writes the same `exchange_controls` row the settlement path checks, so
 * a pause takes effect on the next request. The blacklist is checked by the swap
 * and lending paths; a token that is blacklisted is refused even if a pool still
 * holds it.
 */
const SCOPES = ['dex', 'dex_perps', 'dex_margin', 'dex_bridge'] as const;
const BLACKLIST_KINDS = ['token', 'wallet', 'pool'] as const;

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const db = getDb();
  const controls = db.prepare('SELECT * FROM exchange_controls ORDER BY scope').all() as Array<Record<string, unknown>>;
  const blacklist = db.prepare('SELECT * FROM dex_blacklist ORDER BY created_at DESC LIMIT 500').all() as Array<Record<string, unknown>>;
  return NextResponse.json({ success: true, controls, blacklist }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const action = String(body.action ?? '').toLowerCase();
  const db = getDb();

  if (action === 'pause' || action === 'resume') {
    const scope = String(body.scope ?? '').toLowerCase();
    if (!SCOPES.includes(scope as (typeof SCOPES)[number])) {
      return fail('VALIDATION_FAILED', `scope must be one of ${SCOPES.join(', ')}`);
    }
    const paused = action === 'pause' ? 1 : 0;
    const reason = body.reason ? String(body.reason).slice(0, 500) : null;
    db.prepare(
      `INSERT INTO exchange_controls (scope, paused, reason, updated_by, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(scope) DO UPDATE SET paused = excluded.paused, reason = excluded.reason,
         updated_by = excluded.updated_by, updated_at = datetime('now')`,
    ).run(scope, paused, reason, auth.admin.email);
    recordAdminAction(request, auth.admin, `dex.${action}`, { type: 'exchange_control', id: scope, detail: { reason } });
    return NextResponse.json({ success: true, scope, paused: paused === 1 });
  }

  if (action === 'blacklist') {
    const kind = String(body.kind ?? '').toLowerCase();
    if (!BLACKLIST_KINDS.includes(kind as (typeof BLACKLIST_KINDS)[number])) {
      return fail('VALIDATION_FAILED', `kind must be one of ${BLACKLIST_KINDS.join(', ')}`);
    }
    const value = String(body.value ?? '').trim();
    if (!value || value.length > 128) return fail('VALIDATION_FAILED', 'value is required');
    const reason = body.reason ? String(body.reason).slice(0, 500) : null;
    db.prepare(
      `INSERT INTO dex_blacklist (entry_id, kind, value, reason, created_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, value) DO UPDATE SET reason = excluded.reason`,
    ).run(generateId(), kind, value, reason, auth.admin.email);
    recordAdminAction(request, auth.admin, 'dex.blacklist.add', { type: 'dex_blacklist', id: `${kind}:${value}`, detail: { reason } });
    return NextResponse.json({ success: true, kind, value }, { status: 201 });
  }

  if (action === 'unblacklist') {
    const kind = String(body.kind ?? '').toLowerCase();
    const value = String(body.value ?? '').trim();
    const result = db.prepare('DELETE FROM dex_blacklist WHERE kind = ? AND value = ?').run(kind, value);
    if (result.changes === 0) return fail('NOT_FOUND', 'no matching blacklist entry', 404);
    recordAdminAction(request, auth.admin, 'dex.blacklist.remove', { type: 'dex_blacklist', id: `${kind}:${value}` });
    return NextResponse.json({ success: true });
  }

  return fail('INVALID_ACTION', 'action must be pause, resume, blacklist or unblacklist');
}
