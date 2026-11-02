import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { validateFuturesMarket } from '@/lib/markets/futures';

/**
 * Futures and perpetual contract listing administration.
 *
 * Covers linear (USDT/USDC/RUSD/RYUSD/TGR-margined), inverse (COIN_M) and
 * dated (quarterly/delivery) contracts. Each listing carries its own funding,
 * oracle-independent risk parameters and fee schedule, so the execution path
 * reads one row rather than inferring defaults.
 */

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

function rowToMarket(row: Record<string, unknown>) {
  return {
    symbol: row.symbol,
    baseAsset: row.base_asset,
    quoteAsset: row.quote_asset,
    settlementAsset: row.settlement_asset,
    contractType: row.contract_type,
    listingType: row.listing_type,
    contractSize: row.contract_size,
    tickSize: row.tick_size,
    pricePrecision: row.price_precision,
    quantityPrecision: row.quantity_precision,
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
    deliveryTimeNs: row.delivery_time_ns ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

// List every futures market, optionally filtered by status or contract type.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const contractType = searchParams.get('contractType')?.toUpperCase();

  const clauses: string[] = [];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status.toLowerCase());
  }
  if (contractType) {
    clauses.push('contract_type = ?');
    params.push(contractType);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM futures_markets${where} ORDER BY symbol`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    { success: true, markets: rows.map(rowToMarket) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// List a new futures or perpetual market.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const validated = validateFuturesMarket(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const m = validated.market;

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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    m.symbol,
    m.baseAsset,
    m.quoteAsset,
    m.settlementAsset,
    m.contractType,
    m.listingType,
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
    m.deliveryTimeNs,
    m.status,
  );

  recordAdminAction(request, auth.admin, 'market.futures.list', {
    type: 'futures_market',
    id: m.symbol,
    detail: m,
  });

  return NextResponse.json({ success: true, market: m }, { status: 201 });
}

// Update an existing futures listing.
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const validated = validateFuturesMarket(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const m = validated.market;

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM futures_markets WHERE symbol = ?').get(m.symbol)) {
    return fail('UNKNOWN_SYMBOL', `${m.symbol} is not listed`, 404);
  }

  db.prepare(
    `UPDATE futures_markets
        SET settlement_asset = ?, contract_type = ?, listing_type = ?, contract_size = ?,
            tick_size = ?, price_precision = ?, quantity_precision = ?, min_quantity = ?,
            max_quantity = ?, max_leverage = ?, maker_fee_bps = ?, taker_fee_bps = ?,
            funding_interval_hours = ?, funding_rate_cap = ?, maintenance_margin_rate = ?,
            initial_margin_rate = ?, liquidation_fee_rate = ?, insurance_fund_share = ?,
            delivery_time_ns = ?, status = ?
      WHERE symbol = ?`,
  ).run(
    m.settlementAsset,
    m.contractType,
    m.listingType,
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
    m.deliveryTimeNs,
    m.status,
    m.symbol,
  );

  recordAdminAction(request, auth.admin, 'market.futures.update', {
    type: 'futures_market',
    id: m.symbol,
    detail: m,
  });

  return NextResponse.json({ success: true, market: m });
}

// Delist a futures market.
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase();
  if (!symbol) return fail('VALIDATION_FAILED', 'symbol query parameter is required');

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM futures_markets WHERE symbol = ?').get(symbol)) {
    return fail('UNKNOWN_SYMBOL', `${symbol} is not listed`, 404);
  }

  db.prepare('DELETE FROM futures_markets WHERE symbol = ?').run(symbol);

  recordAdminAction(request, auth.admin, 'market.futures.delist', {
    type: 'futures_market',
    id: symbol,
  });

  return NextResponse.json({ success: true, symbol });
}
