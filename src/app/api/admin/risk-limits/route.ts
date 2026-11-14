import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { validateRiskLimit } from '@/lib/markets/instruments';

export const dynamic = 'force-dynamic';

/**
 * Per-market leverage brackets.
 *
 * A market's tiers are ascending by notional; the first tier whose cap covers a
 * requested notional sets the maximum leverage and the maintenance margin rate
 * for that position. A market with no tiers cannot be traded, so the console
 * must be able to define them.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const symbol = request.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  const clauses: string[] = [];
  const params: string[] = [];
  if (symbol) {
    clauses.push('symbol = ?');
    params.push(symbol);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM risk_limits${where} ORDER BY symbol, tier`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      limits: rows.map((row) => ({
        symbol: row.symbol,
        tier: row.tier,
        maxPositionNotional: row.max_position_notional,
        maxLeverage: row.max_leverage,
        maintenanceMarginRate: row.maintenance_margin_rate,
      })),
    },
    { headers: NO_STORE },
  );
}

/**
 * Create or replace a leverage bracket.
 *
 * A lower tier must not permit more leverage than a higher tier, and its
 * maintenance rate must not be higher, or the bracket table would be
 * inconsistent with the risk engine's assumptions.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.risk-limits');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const validated = validateRiskLimit(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const limit = validated.limit;

  const db = getDb();
  const tiers = db
    .prepare('SELECT tier, max_position_notional, max_leverage, maintenance_margin_rate FROM risk_limits WHERE symbol = ? ORDER BY tier')
    .all(limit.symbol) as Array<{ tier: number; max_position_notional: number; max_leverage: number; maintenance_margin_rate: number }>;

  for (const existing of tiers) {
    if (existing.tier === limit.tier) continue;
    if (existing.tier < limit.tier) {
      if (limit.maxLeverage > existing.max_leverage) {
        return fail('VALIDATION_FAILED', `Tier ${limit.tier} cannot allow more leverage than tier ${existing.tier}`);
      }
      if (limit.maxPositionNotional <= existing.max_position_notional) {
        return fail('VALIDATION_FAILED', `Tier ${limit.tier} must raise the notional cap above tier ${existing.tier}`);
      }
      if (limit.maintenanceMarginRate < existing.maintenance_margin_rate) {
        return fail('VALIDATION_FAILED', `Tier ${limit.tier} cannot require a lower maintenance rate than tier ${existing.tier}`);
      }
    } else {
      if (limit.maxLeverage < existing.max_leverage) {
        return fail('VALIDATION_FAILED', `Tier ${limit.tier} cannot allow less leverage than tier ${existing.tier}`);
      }
      if (limit.maxPositionNotional >= existing.max_position_notional) {
        return fail('VALIDATION_FAILED', `Tier ${limit.tier} must raise the notional cap above tier ${existing.tier}`);
      }
      if (limit.maintenanceMarginRate > existing.maintenance_margin_rate) {
        return fail('VALIDATION_FAILED', `Tier ${limit.tier} cannot require a higher maintenance rate than tier ${existing.tier}`);
      }
    }
  }

  db.prepare(
    `INSERT INTO risk_limits (limit_id, symbol, tier, max_position_notional, max_leverage, maintenance_margin_rate)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, tier) DO UPDATE SET
       max_position_notional = excluded.max_position_notional,
       max_leverage = excluded.max_leverage,
       maintenance_margin_rate = excluded.maintenance_margin_rate`,
  ).run(generateId(), limit.symbol, limit.tier, limit.maxPositionNotional, limit.maxLeverage, limit.maintenanceMarginRate);

  recordAdminAction(request, auth.admin, 'risk_limit.set', {
    type: 'risk_limit',
    id: `${limit.symbol}:${limit.tier}`,
    detail: limit,
  });

  return NextResponse.json({ success: true, limit }, { headers: NO_STORE });
}

/** Remove a leverage bracket. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.risk-limits.delete');
  if (guard) return guard;

  const symbol = request.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  const tier = Number(request.nextUrl.searchParams.get('tier'));
  if (!symbol || !/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(symbol)) {
    return fail('VALIDATION_FAILED', 'symbol query parameter is required');
  }
  if (!Number.isInteger(tier) || tier < 1) return fail('VALIDATION_FAILED', 'tier query parameter is required');

  const result = getDb().prepare('DELETE FROM risk_limits WHERE symbol = ? AND tier = ?').run(symbol, tier);
  if (result.changes === 0) return fail('UNKNOWN_TIER', 'No such risk tier', 404);

  recordAdminAction(request, auth.admin, 'risk_limit.delete', {
    type: 'risk_limit',
    id: `${symbol}:${tier}`,
  });

  return NextResponse.json({ success: true, symbol, tier }, { headers: NO_STORE });
}
