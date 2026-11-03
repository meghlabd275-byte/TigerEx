import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Exchange settings, stored as key/value pairs.
 *
 * The settings the runtime reads (maintenance mode, whether trading and
 * withdrawals are enabled) live in this table, so the console is the single
 * place they are changed and the change is audited.
 */

const SETTING_KEY_RE = /^[a-z0-9_]{1,64}$/;

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rows = getDb()
    .prepare('SELECT key, value, category, updated_by, updated_at FROM system_settings ORDER BY category, key')
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json({ success: true, data: rows }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.settings');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const key = typeof body.key === 'string' ? body.key : '';
  if (!SETTING_KEY_RE.test(key)) return fail('VALIDATION_FAILED', 'A valid setting key is required');
  if (typeof body.value !== 'string') return fail('VALIDATION_FAILED', 'Setting value must be a string');
  if (body.value.length > 4096) return fail('VALIDATION_FAILED', 'Setting value is too long');

  const db = getDb();
  const existing = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;

  db.prepare(
    `INSERT INTO system_settings (key, value, category, updated_by, updated_at)
     VALUES (?, ?, 'general', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).run(key, body.value, auth.admin.email);

  recordAdminAction(request, auth.admin, 'settings.update', {
    type: 'setting',
    id: key,
    detail: { from: existing?.value ?? null, to: body.value },
  });

  return NextResponse.json({ success: true, key, value: body.value }, { headers: NO_STORE });
}
