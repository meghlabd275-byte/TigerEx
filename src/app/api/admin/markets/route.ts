import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * List every tradable market with its status and fee schedule.
 *
 * Served from the exchange's own listing tables. `trading_pairs` is the spot
 * venue; the derivatives and TradFi venues are included so the console shows
 * every instrument the exchange offers in one place.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();

  const spot = db
    .prepare(
      `SELECT pair_id AS id, symbol, base_currency, quote_currency, status, maker_fee, taker_fee, created_at
         FROM trading_pairs ORDER BY symbol`,
    )
    .all() as Array<Record<string, unknown>>;

  const futures = db
    .prepare(
      `SELECT market_id AS id, symbol, base_asset, quote_asset, status, maker_fee_bps, taker_fee_bps, created_at
         FROM futures_markets ORDER BY symbol`,
    )
    .all() as Array<Record<string, unknown>>;

  const options = db
    .prepare(
      `SELECT market_id AS id, symbol, underlying, status, maker_fee_bps, taker_fee_bps, created_at
         FROM options_markets ORDER BY symbol`,
    )
    .all() as Array<Record<string, unknown>>;

  const etf = db
    .prepare(
      `SELECT market_id AS id, symbol, underlying, status, created_at
         FROM etf_markets ORDER BY symbol`,
    )
    .all() as Array<Record<string, unknown>>;

  const tradfi = db
    .prepare(
      `SELECT market_id AS id, symbol, instrument_type, status, maker_fee_bps, taker_fee_bps, created_at
         FROM tradfi_markets ORDER BY symbol`,
    )
    .all() as Array<Record<string, unknown>>;

  const normalize = (row: Record<string, unknown>, venue: string) => ({
    id: row.id,
    symbol: row.symbol,
    baseAsset: row.base_currency ?? row.base_asset ?? row.underlying ?? null,
    quoteAsset: row.quote_currency ?? row.quote_asset ?? null,
    venue,
    status: row.status,
    makerFeeBps: row.maker_fee !== undefined ? Number(row.maker_fee) * 10_000 : row.maker_fee_bps ?? null,
    takerFeeBps: row.taker_fee !== undefined ? Number(row.taker_fee) * 10_000 : row.taker_fee_bps ?? null,
    createdAt: row.created_at,
  });

  return NextResponse.json(
    {
      success: true,
      markets: [
        ...spot.map((r) => normalize(r, 'spot')),
        ...futures.map((r) => normalize(r, 'futures')),
        ...options.map((r) => normalize(r, 'options')),
        ...etf.map((r) => normalize(r, 'etf')),
        ...tradfi.map((r) => normalize(r, 'tradfi')),
      ],
    },
    { headers: NO_STORE },
  );
}
