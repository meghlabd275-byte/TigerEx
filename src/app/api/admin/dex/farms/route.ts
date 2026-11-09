import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { validateFarmInput } from '@/lib/dex/validation';
import { recomputeGaugeWeights } from '@/lib/dex/farm-service';

/**
 * TigerSwap farm, gauge and emission administration.
 *
 * Creating a farm binds a pool to a reward token and rate; the gauge that
 * receives the epoch's emission is created with the farm so a new pool can be
 * voted on immediately. Every mutation is audited.
 */
function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const db = getDb();
  const farms = db.prepare('SELECT * FROM dex_farms ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  const gauges = db.prepare('SELECT * FROM dex_gauges ORDER BY weight DESC').all() as Array<Record<string, unknown>>;
  const bribes = db.prepare('SELECT * FROM dex_bribes ORDER BY created_at DESC LIMIT 200').all() as Array<Record<string, unknown>>;
  return NextResponse.json({ success: true, farms, gauges, bribes }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }
  const validated = validateFarmInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const farm = validated.value;

  const db = getDb();
  const pool = db.prepare('SELECT pool_id FROM dex_pools WHERE pool_id = ?').get(farm.poolId) as { pool_id: string } | undefined;
  if (!pool) return fail('UNKNOWN_POOL', 'the farm must point at a listed pool', 404);
  if (db.prepare('SELECT 1 FROM dex_farms WHERE name = ?').get(farm.name)) {
    return fail('DUPLICATE_FARM', `${farm.name} already exists`, 409);
  }

  const farmId = generateId();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO dex_farms (farm_id, name, pool_id, reward_token, reward_rate, boost_multiplier, start_at, end_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(farmId, farm.name, farm.poolId, farm.rewardToken, farm.rewardRate, farm.boostMultiplier, farm.startAt, farm.endAt, farm.status);
    db.prepare('INSERT OR IGNORE INTO dex_gauges (gauge_id, pool_id) VALUES (?, ?)').run(generateId(), farm.poolId);
  })();
  recomputeGaugeWeights();
  recordAdminAction(request, auth.admin, 'dex.farm.create', { type: 'dex_farm', id: farmId, detail: farm });
  return NextResponse.json({ success: true, farmId }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }
  const farmId = String(body.farmId ?? '');
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM dex_farms WHERE farm_id = ?').get(farmId)) {
    return fail('UNKNOWN_FARM', 'farm does not exist', 404);
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (body.rewardRate !== undefined) {
    const rate = Number(body.rewardRate);
    if (!Number.isFinite(rate) || rate < 0) return fail('VALIDATION_FAILED', 'rewardRate must not be negative');
    updates.push('reward_rate = ?');
    params.push(rate);
  }
  if (body.apr !== undefined) {
    const apr = Number(body.apr);
    if (!Number.isFinite(apr) || apr < 0) return fail('VALIDATION_FAILED', 'apr must not be negative');
    updates.push('apr = ?');
    params.push(apr);
  }
  if (body.status !== undefined) {
    const status = String(body.status).toLowerCase();
    if (!['active', 'paused', 'ended'].includes(status)) return fail('VALIDATION_FAILED', 'status must be active, paused or ended');
    updates.push('status = ?');
    params.push(status);
  }
  if (updates.length === 0) return fail('NOTHING_TO_UPDATE', 'no mutable field was provided');

  params.push(farmId);
  db.prepare(`UPDATE dex_farms SET ${updates.join(', ')} WHERE farm_id = ?`).run(...params);
  recordAdminAction(request, auth.admin, 'dex.farm.update', { type: 'dex_farm', id: farmId, detail: body });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const farmId = request.nextUrl.searchParams.get('farmId')?.trim();
  if (!farmId) return fail('VALIDATION_FAILED', 'farmId query parameter is required');
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM dex_farms WHERE farm_id = ?').get(farmId)) {
    return fail('UNKNOWN_FARM', 'farm does not exist', 404);
  }
  const stakes = db.prepare('SELECT COUNT(*) AS n FROM dex_farm_stakes WHERE farm_id = ?').get(farmId) as { n: number };
  if (stakes.n > 0) return fail('STAKES_PRESENT', `${stakes.n} stake(s) remain; they must be withdrawn first`, 409);
  db.prepare("UPDATE dex_farms SET status = 'ended' WHERE farm_id = ?").run(farmId);
  recordAdminAction(request, auth.admin, 'dex.farm.end', { type: 'dex_farm', id: farmId });
  return NextResponse.json({ success: true, farmId });
}
