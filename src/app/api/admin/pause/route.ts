import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Exchange-wide and per-venue pause controls (circuit breakers).
 *
 * A scope is paused with a reason so the public status page can explain why.
 * Pausing `exchange` implies every venue; the execution path checks the scope
 * it is about to use, so a paused venue stops accepting orders immediately.
 */

const SCOPES = ['spot', 'futures', 'margin', 'options', 'etf', 'tradfi', 'deposits', 'withdrawals', 'p2p', 'pay', 'exchange'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rows = getDb()
    .prepare('SELECT scope, paused, reason, updated_by, updated_at FROM exchange_controls ORDER BY scope')
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      controls: rows.map((row) => ({
        scope: row.scope,
        paused: row.paused === 1,
        reason: row.reason ?? null,
        updatedBy: row.updated_by ?? null,
        updatedAt: row.updated_at,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.pause');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const scope = String(body.scope ?? '').trim().toLowerCase();
  if (!SCOPES.includes(scope)) {
    return fail('VALIDATION_FAILED', `scope must be one of ${SCOPES.join(', ')}`);
  }

  if (typeof body.paused !== 'boolean') {
    return fail('VALIDATION_FAILED', 'paused must be a boolean');
  }
  const paused = body.paused;

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (paused && reason.length === 0) {
    return fail('VALIDATION_FAILED', 'A reason is required when pausing a scope');
  }

  const db = getDb();
  const existing = db.prepare('SELECT paused FROM exchange_controls WHERE scope = ?').get(scope) as
    | { paused: number }
    | undefined;

  db.prepare(
    `INSERT INTO exchange_controls (scope, paused, reason, updated_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(scope) DO UPDATE SET
       paused = excluded.paused, reason = excluded.reason,
       updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).run(scope, paused ? 1 : 0, reason || null, auth.admin.email);

  recordAdminAction(request, auth.admin, paused ? 'control.pause' : 'control.resume', {
    type: 'exchange_control',
    id: scope,
    detail: { from: existing?.paused === 1, to: paused, reason: reason || null },
  });

  return NextResponse.json({ success: true, scope, paused, reason: reason || null }, { headers: NO_STORE });
}
