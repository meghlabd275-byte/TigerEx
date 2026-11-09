import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { validateLendingMarketInput, lendingMarketRowToInput } from '@/lib/dex/validation';
import { listLendingMarkets } from '@/lib/dex/margin-service';

/**
 * TigerSwap lending and isolated-pool administration.
 *
 * A lending market is the borrowable asset with its collateral schedule and
 * interest model. Isolated pools are the same row with their own caps, so an
 * isolated risk never contaminates another market. Every mutation is audited.
 */
function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  return NextResponse.json({ success: true, markets: listLendingMarkets() }, { headers: { 'Cache-Control': 'no-store' } });
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
  const validated = validateLendingMarketInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const market = validated.value;

  const db = getDb();
  if (db.prepare('SELECT 1 FROM dex_lending_markets WHERE asset = ?').get(market.asset)) {
    return fail('DUPLICATE_MARKET', `${market.asset} is already a lending market`, 409);
  }
  const marketId = generateId();
  db.prepare(
    `INSERT INTO dex_lending_markets
       (market_id, asset, ltv, liquidation_threshold, liquidation_bonus, base_rate, kink, jump_multiplier, supply_cap, borrow_cap, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    marketId,
    market.asset,
    market.ltv,
    market.liquidationThreshold,
    market.liquidationBonus,
    market.baseRate,
    market.kink,
    market.jumpMultiplier,
    market.supplyCap,
    market.borrowCap,
    market.status,
  );
  recordAdminAction(request, auth.admin, 'dex.margin.market.create', { type: 'dex_lending_market', id: marketId, detail: market });
  return NextResponse.json({ success: true, marketId }, { status: 201 });
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
  const asset = String(body.asset ?? '').trim().toUpperCase();
  const db = getDb();
  const existing = db.prepare('SELECT * FROM dex_lending_markets WHERE asset = ?').get(asset) as Record<string, unknown> | undefined;
  if (!existing) return fail('UNKNOWN_MARKET', `${asset} is not a lending market`, 404);

  // The validator reads camelCase fields while the row is snake_case, so the
  // row must be mapped before the update is merged; spreading it directly would
  // drop every unchanged field and fail validation on a partial update.
  const validated = validateLendingMarketInput({ ...lendingMarketRowToInput(existing), ...body });
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const market = validated.value;

  db.prepare(
    `UPDATE dex_lending_markets SET ltv = ?, liquidation_threshold = ?, liquidation_bonus = ?, base_rate = ?,
        kink = ?, jump_multiplier = ?, supply_cap = ?, borrow_cap = ?, status = ? WHERE asset = ?`,
  ).run(
    market.ltv,
    market.liquidationThreshold,
    market.liquidationBonus,
    market.baseRate,
    market.kink,
    market.jumpMultiplier,
    market.supplyCap,
    market.borrowCap,
    market.status,
    market.asset,
  );
  recordAdminAction(request, auth.admin, 'dex.margin.market.update', { type: 'dex_lending_market', id: market.asset, detail: market });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const asset = request.nextUrl.searchParams.get('asset')?.trim().toUpperCase();
  if (!asset) return fail('VALIDATION_FAILED', 'asset query parameter is required');
  const db = getDb();
  const market = db.prepare('SELECT market_id FROM dex_lending_markets WHERE asset = ?').get(asset) as { market_id: string } | undefined;
  if (!market) return fail('UNKNOWN_MARKET', `${asset} is not a lending market`, 404);

  const open = db
    .prepare('SELECT COUNT(*) AS n FROM dex_lending_positions WHERE market_id = ? AND (supplied > 0 OR borrowed > 0)')
    .get(market.market_id) as { n: number };
  if (open.n > 0) return fail('POSITIONS_PRESENT', `${open.n} position(s) remain; they must be closed first`, 409);

  db.prepare("UPDATE dex_lending_markets SET status = 'paused' WHERE market_id = ?").run(market.market_id);
  recordAdminAction(request, auth.admin, 'dex.margin.market.pause', { type: 'dex_lending_market', id: asset });
  return NextResponse.json({ success: true, asset });
}
