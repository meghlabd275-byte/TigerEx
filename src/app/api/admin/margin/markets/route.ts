import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { validateMarginMarket } from '@/lib/markets/futures';

export const dynamic = 'force-dynamic';

/**
 * Spot margin listing administration.
 *
 * A margin listing binds a pair to its collateral schedule, borrowable set and
 * interest model. Isolated listings carry the same fields with `mode` set to
 * `isolated`; an isolated pool therefore needs no separate table.
 */

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToMarket(row: Record<string, unknown>) {
  return {
    symbol: row.symbol,
    baseAsset: row.base_asset,
    quoteAsset: row.quote_asset,
    mode: row.mode,
    maxLeverage: row.max_leverage,
    collateralLtv: parseJson<Record<string, number>>(row.collateral_ltv, {}),
    liquidationThresholds: parseJson<Record<string, number>>(row.liquidation_thresholds, {}),
    borrowableAssets: parseJson<string[]>(row.borrowable_assets, []),
    interestBaseApr: row.interest_base_apr,
    interestKinkUtilization: row.interest_kink_utilization,
    interestKinkApr: row.interest_kink_apr,
    interestMaxApr: row.interest_max_apr,
    liquidationBonus: row.liquidation_bonus,
    riskTier: row.risk_tier,
    status: row.status,
    createdAt: row.created_at,
  };
}

// List every margin market, optionally filtered by status or mode.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const mode = searchParams.get('mode')?.toLowerCase();

  const clauses: string[] = [];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status.toLowerCase());
  }
  if (mode) {
    clauses.push('mode = ?');
    params.push(mode);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM margin_markets${where} ORDER BY symbol`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    { success: true, markets: rows.map(rowToMarket) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// List a new margin market.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'market.margin.create');
  if (guard) return guard;


  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const validated = validateMarginMarket(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const m = validated.market;

  const db = getDb();
  if (db.prepare('SELECT 1 FROM margin_markets WHERE symbol = ?').get(m.symbol)) {
    return fail('DUPLICATE_SYMBOL', `${m.symbol} is already listed`, 409);
  }

  db.prepare(
    `INSERT INTO margin_markets
       (market_id, symbol, base_asset, quote_asset, mode, max_leverage,
        collateral_ltv, liquidation_thresholds, borrowable_assets, interest_base_apr,
        interest_kink_utilization, interest_kink_apr, interest_max_apr, liquidation_bonus,
        risk_tier, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    m.symbol,
    m.baseAsset,
    m.quoteAsset,
    m.mode,
    m.maxLeverage,
    JSON.stringify(m.collateralLtv),
    JSON.stringify(m.liquidationThresholds),
    JSON.stringify(m.borrowableAssets),
    m.interestBaseApr,
    m.interestKinkUtilization,
    m.interestKinkApr,
    m.interestMaxApr,
    m.liquidationBonus,
    m.riskTier,
    m.status,
  );

  recordAdminAction(request, auth.admin, 'market.margin.list', {
    type: 'margin_market',
    id: m.symbol,
    detail: m,
  });

  return NextResponse.json({ success: true, market: m }, { status: 201 });
}

// Update an existing margin listing.
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'market.margin.update');
  if (guard) return guard;


  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const validated = validateMarginMarket(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const m = validated.market;

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM margin_markets WHERE symbol = ?').get(m.symbol)) {
    return fail('UNKNOWN_SYMBOL', `${m.symbol} is not listed`, 404);
  }

  db.prepare(
    `UPDATE margin_markets
        SET mode = ?, max_leverage = ?, collateral_ltv = ?, liquidation_thresholds = ?,
            borrowable_assets = ?, interest_base_apr = ?, interest_kink_utilization = ?,
            interest_kink_apr = ?, interest_max_apr = ?, liquidation_bonus = ?,
            risk_tier = ?, status = ?
      WHERE symbol = ?`,
  ).run(
    m.mode,
    m.maxLeverage,
    JSON.stringify(m.collateralLtv),
    JSON.stringify(m.liquidationThresholds),
    JSON.stringify(m.borrowableAssets),
    m.interestBaseApr,
    m.interestKinkUtilization,
    m.interestKinkApr,
    m.interestMaxApr,
    m.liquidationBonus,
    m.riskTier,
    m.status,
    m.symbol,
  );

  recordAdminAction(request, auth.admin, 'market.margin.update', {
    type: 'margin_market',
    id: m.symbol,
    detail: m,
  });

  return NextResponse.json({ success: true, market: m });
}

// Delist a margin market.
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'market.margin.delist');
  if (guard) return guard;


  const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase();
  if (!symbol) return fail('VALIDATION_FAILED', 'symbol query parameter is required');

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM margin_markets WHERE symbol = ?').get(symbol)) {
    return fail('UNKNOWN_SYMBOL', `${symbol} is not listed`, 404);
  }

  db.prepare('DELETE FROM margin_markets WHERE symbol = ?').run(symbol);

  recordAdminAction(request, auth.admin, 'market.margin.delist', {
    type: 'margin_market',
    id: symbol,
  });

  return NextResponse.json({ success: true, symbol });
}
