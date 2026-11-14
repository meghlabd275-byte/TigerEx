import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { validateFuturesMarket } from '@/lib/markets/futures';

export const dynamic = 'force-dynamic';

/**
 * Perpetual contract listing administration.
 *
 * Perpetuals share the `futures_markets` table with dated contracts, so this
 * route fixes `listingType` to `perpetual` and refuses a `deliveryTimeNs`: a
 * perpetual must never carry a delivery time, and the validator enforces it.
 * This is the dedicated surface the console uses for perp listings.
 */

function rowToPerp(row: Record<string, unknown>) {
  return {
    symbol: row.symbol,
    baseAsset: row.base_asset,
    quoteAsset: row.quote_asset,
    settlementAsset: row.settlement_asset,
    contractType: row.contract_type,
    contractSize: row.contract_size,
    tickSize: row.tick_size,
    minQuantity: row.min_quantity,
    maxQuantity: row.max_quantity,
    maxLeverage: row.max_leverage,
    makerFeeBps: row.maker_fee_bps,
    takerFeeBps: row.taker_fee_bps,
    fundingIntervalHours: row.funding_interval_hours,
    fundingRateCap: row.funding_rate_cap,
    maintenanceMarginRate: row.maintenance_margin_rate,
    initialMarginRate: row.initial_margin_rate,
    liquidationFeeRate: row.liquidation_fee_rate,
    insuranceFundShare: row.insurance_fund_share,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const contractType = searchParams.get('contractType')?.toUpperCase();

  const clauses: string[] = ["listing_type = 'perpetual'"];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status.toLowerCase());
  }
  if (contractType) {
    clauses.push('contract_type = ?');
    params.push(contractType);
  }

  const rows = getDb()
    .prepare(`SELECT * FROM futures_markets WHERE ${clauses.join(' AND ')} ORDER BY symbol`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json({ success: true, perps: rows.map(rowToPerp) }, { headers: NO_STORE });
}

/** List a new perpetual. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.perps.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  if (body.listingType !== undefined && String(body.listingType).toLowerCase() !== 'perpetual') {
    return fail('VALIDATION_FAILED', 'This endpoint lists perpetuals; listingType must be perpetual');
  }

  const validated = validateFuturesMarket({ ...body, listingType: 'perpetual' });
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const m = validated.market;
  if (m.deliveryTimeNs !== null) {
    return fail('VALIDATION_FAILED', 'A perpetual must not carry a delivery time');
  }

  const db = getDb();
  if (db.prepare('SELECT 1 FROM futures_markets WHERE symbol = ?').get(m.symbol)) {
    return fail('DUPLICATE_SYMBOL', `${m.symbol} is already listed`, 409);
  }

  db.prepare(
    `INSERT INTO futures_markets
       (market_id, symbol, base_asset, quote_asset, settlement_asset, contract_type,
        listing_type, contract_size, tick_size, price_precision, quantity_precision,
        min_quantity, max_quantity, max_leverage, maker_fee_bps, taker_fee_bps,
        funding_interval_hours, funding_rate_cap, maintenance_margin_rate,
        initial_margin_rate, liquidation_fee_rate, insurance_fund_share,
        delivery_time_ns, status)
     VALUES (?, ?, ?, ?, ?, ?, 'perpetual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    generateId(),
    m.symbol,
    m.baseAsset,
    m.quoteAsset,
    m.settlementAsset,
    m.contractType,
    m.contractSize,
    m.tickSize,
    m.pricePrecision,
    m.quantityPrecision,
    m.minQuantity,
    m.maxQuantity,
    m.maxLeverage,
    m.makerFeeBps,
    m.takerFeeBps,
    m.fundingIntervalHours,
    m.fundingRateCap,
    m.maintenanceMarginRate,
    m.initialMarginRate,
    m.liquidationFeeRate,
    m.insuranceFundShare,
    m.status,
  );

  recordAdminAction(request, auth.admin, 'market.perps.list', { type: 'perpetual_market', id: m.symbol, detail: m });
  return NextResponse.json({ success: true, perp: m }, { status: 201, headers: NO_STORE });
}

/** Update an existing perpetual. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.perps.update');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const validated = validateFuturesMarket({ ...body, listingType: 'perpetual' });
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const m = validated.market;

  const db = getDb();
  const existing = db.prepare('SELECT listing_type FROM futures_markets WHERE symbol = ?').get(m.symbol) as
    | { listing_type: string }
    | undefined;
  if (!existing) return fail('UNKNOWN_SYMBOL', `${m.symbol} is not listed`, 404);
  if (existing.listing_type !== 'perpetual') {
    return fail('NOT_A_PERPETUAL', `${m.symbol} is a ${existing.listing_type} contract, not a perpetual`, 409);
  }

  db.prepare(
    `UPDATE futures_markets
        SET settlement_asset = ?, contract_type = ?, contract_size = ?, tick_size = ?,
            price_precision = ?, quantity_precision = ?, min_quantity = ?, max_quantity = ?,
            max_leverage = ?, maker_fee_bps = ?, taker_fee_bps = ?, funding_interval_hours = ?,
            funding_rate_cap = ?, maintenance_margin_rate = ?, initial_margin_rate = ?,
            liquidation_fee_rate = ?, insurance_fund_share = ?, delivery_time_ns = NULL, status = ?
      WHERE symbol = ?`,
  ).run(
    m.settlementAsset,
    m.contractType,
    m.contractSize,
    m.tickSize,
    m.pricePrecision,
    m.quantityPrecision,
    m.minQuantity,
    m.maxQuantity,
    m.maxLeverage,
    m.makerFeeBps,
    m.takerFeeBps,
    m.fundingIntervalHours,
    m.fundingRateCap,
    m.maintenanceMarginRate,
    m.initialMarginRate,
    m.liquidationFeeRate,
    m.insuranceFundShare,
    m.status,
    m.symbol,
  );

  recordAdminAction(request, auth.admin, 'market.perps.update', { type: 'perpetual_market', id: m.symbol, detail: m });
  return NextResponse.json({ success: true, perp: m }, { headers: NO_STORE });
}

/** Delist a perpetual. Open positions must be settled first. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.perps.delist');
  if (guard) return guard;

  const symbol = request.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  if (!symbol) return fail('VALIDATION_FAILED', 'symbol query parameter is required');

  const db = getDb();
  const existing = db.prepare('SELECT listing_type FROM futures_markets WHERE symbol = ?').get(symbol) as
    | { listing_type: string }
    | undefined;
  if (!existing) return fail('UNKNOWN_SYMBOL', `${symbol} is not listed`, 404);
  if (existing.listing_type !== 'perpetual') {
    return fail('NOT_A_PERPETUAL', `${symbol} is a ${existing.listing_type} contract, not a perpetual`, 409);
  }

  const open = (
    db.prepare("SELECT COUNT(*) AS n FROM futures_positions WHERE symbol = ? AND status = 'open'").get(symbol) as { n: number }
  ).n;
  if (open > 0) {
    return fail('OPEN_POSITIONS', `${symbol} has ${open} open position(s); pause it instead of delisting`, 409);
  }

  db.prepare('DELETE FROM futures_markets WHERE symbol = ?').run(symbol);
  recordAdminAction(request, auth.admin, 'market.perps.delist', { type: 'perpetual_market', id: symbol });
  return NextResponse.json({ success: true, symbol }, { headers: NO_STORE });
}
