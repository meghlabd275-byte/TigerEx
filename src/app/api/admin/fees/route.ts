import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The exchange fee schedule by VIP level.
 *
 * Rates are stored in basis points. Editing a level changes what the fee engine
 * resolves for every user in it, so the change is validated and audited.
 */

const RATE_MIN_BPS = 0;
const RATE_MAX_BPS = 10_000; // a fee at or above 100% is not a fee

function rowToTier(row: Record<string, unknown>) {
  return {
    id: String(row.level),
    level: row.level,
    name: row.name,
    spot_maker_bps: row.spot_maker_bps,
    spot_taker_bps: row.spot_taker_bps,
    futures_maker_bps: row.futures_maker_bps,
    futures_taker_bps: row.futures_taker_bps,
    volume_threshold: row.volume_threshold,
    tgr_holding_threshold: row.tgr_holding_threshold,
    updated_at: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rows = getDb()
    .prepare('SELECT * FROM fee_schedule ORDER BY level')
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json({ success: true, data: rows.map(rowToTier) }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.fees');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const level = Number(body.level ?? body.id);
  if (!Number.isInteger(level) || level < 0 || level > 20) {
    return fail('VALIDATION_FAILED', 'level must be an integer in [0, 20]');
  }

  const updates = (body.updates ?? body) as Record<string, unknown>;
  const allowed = ['spot_maker_bps', 'spot_taker_bps', 'futures_maker_bps', 'futures_taker_bps', 'volume_threshold', 'tgr_holding_threshold'];
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const column of allowed) {
    if (!(column in updates)) continue;
    const value = Number(updates[column]);
    if (!Number.isFinite(value) || value < 0) {
      return fail('VALIDATION_FAILED', `${column} must be a non-negative number`);
    }
    if (column.endsWith('_bps') && value >= RATE_MAX_BPS) {
      return fail('VALIDATION_FAILED', `${column} must be below ${RATE_MAX_BPS} basis points`);
    }
    assignments.push(`${column} = ?`);
    values.push(value);
  }

  if (assignments.length === 0) return fail('VALIDATION_FAILED', 'No updatable fee fields were supplied');

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM fee_schedule WHERE level = ?').get(level)) {
    return fail('UNKNOWN_LEVEL', `VIP level ${level} does not exist`, 404);
  }

  db.prepare(
    `UPDATE fee_schedule SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE level = ?`,
  ).run(...values, level);

  recordAdminAction(request, auth.admin, 'fees.update', {
    type: 'fee_schedule',
    id: String(level),
    detail: updates,
  });

  const row = db.prepare('SELECT * FROM fee_schedule WHERE level = ?').get(level) as Record<string, unknown>;
  return NextResponse.json({ success: true, data: rowToTier(row) }, { headers: NO_STORE });
}
