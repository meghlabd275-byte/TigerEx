import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, NO_STORE, enforceRequestGuards } from '@/lib/api/route-guards';
import { applyFunding, liquidatePosition, markPrice, perpPositions } from '@/lib/dex/perps-service';

/**
 * Perpetual risk administration for TigerSwap.
 *
 * Listing and delisting of perpetual contracts is handled by
 * `/api/admin/futures/markets`, which writes the same `futures_markets` rows the
 * DEX settlement path reads. This route covers the risk actions: overriding a
 * funding rate, inspecting open interest, and force-liquidating a position that
 * the keeper could not close.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const markets = db
    .prepare("SELECT symbol, base_asset, settlement_asset, max_leverage, funding_rate_cap, maintenance_margin_rate, status FROM futures_markets ORDER BY symbol")
    .all() as Array<Record<string, unknown>>;

  const enriched = markets.map((market) => {
    const open = db
      .prepare("SELECT COUNT(*) AS positions, COALESCE(SUM(size * entry_price), 0) AS open_interest FROM dex_perp_positions WHERE market = ? AND status = 'open'")
      .get(market.symbol) as { positions: number; open_interest: number };
    let mark: number | null = null;
    try {
      mark = markPrice(String(market.symbol));
    } catch {
      mark = null;
    }
    return { ...market, openPositions: open.positions, openInterest: open.open_interest, markPrice: mark };
  });

  return NextResponse.json({ success: true, markets: enriched }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.dex.perps.post');
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const action = String(body.action ?? '').toLowerCase();
  const symbol = String(body.symbol ?? '').trim().toUpperCase();

  if (action === 'funding') {
    const db = getDb();
    const market = db.prepare('SELECT symbol, funding_rate_cap FROM futures_markets WHERE symbol = ?').get(symbol) as
      | { symbol: string; funding_rate_cap: number }
      | undefined;
    if (!market) return fail('UNKNOWN_SYMBOL', `${symbol} is not listed`, 404);

    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || Math.abs(rate) > market.funding_rate_cap) {
      return fail('VALIDATION_FAILED', `rate must be a finite number within the ${market.funding_rate_cap} cap`);
    }
    const total = applyFunding(market.symbol, rate);
    recordAdminAction(request, auth.admin, 'dex.perp.funding', { type: 'futures_market', id: symbol, detail: { rate, total } });
    return NextResponse.json({ success: true, total });
  }

  if (action === 'liquidate') {
    const positionId = String(body.positionId ?? '');
    const db = getDb();
    const position = db
      .prepare("SELECT position_id, market FROM dex_perp_positions WHERE position_id = ? AND status = 'open'")
      .get(positionId) as { position_id: string; market: string } | undefined;
    if (!position) return fail('NO_POSITION', 'no open position with that id', 404);

    const mark = markPrice(position.market);
    const result = liquidatePosition(positionId, mark);
    recordAdminAction(request, auth.admin, 'dex.perp.liquidate', { type: 'dex_perp_position', id: positionId, detail: result });
    return NextResponse.json({ success: true, result });
  }

  return fail('INVALID_ACTION', 'action must be funding or liquidate');
}

/** Inspect a user's open positions as an administrator. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.dex.perps.put');
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }
  const userId = String(body.userId ?? '');
  if (!userId) return fail('VALIDATION_FAILED', 'userId is required');
  return NextResponse.json({ success: true, positions: perpPositions(userId) }, { headers: NO_STORE });
}
