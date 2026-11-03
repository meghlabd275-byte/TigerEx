import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Listed futures and perpetual contracts.
 *
 * Reads `futures_markets` and joins the most recent funding observation per
 * symbol so a contract row carries its live mark price, index price and funding
 * rate. When a contract has no funding observation yet those fields are null
 * rather than zero: a zero mark price would be a fabricated price.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contractType = searchParams.get('contractType')?.trim().toUpperCase();
  const listingType = searchParams.get('listingType')?.trim().toLowerCase();
  const settlement = searchParams.get('settlement')?.trim().toUpperCase();

  const clauses: string[] = [];
  const params: string[] = [];
  if (contractType) {
    clauses.push('m.contract_type = ?');
    params.push(contractType);
  }
  if (listingType) {
    clauses.push('m.listing_type = ?');
    params.push(listingType);
  }
  if (settlement) {
    clauses.push('m.settlement_asset = ?');
    params.push(settlement);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(
      `SELECT m.*, f.funding_rate, f.mark_price, f.index_price, f.funding_time_ns
         FROM futures_markets m
         LEFT JOIN funding_rates f
           ON f.symbol = m.symbol
          AND f.funding_time_ns = (SELECT MAX(funding_time_ns) FROM funding_rates WHERE symbol = m.symbol)
        ${where}
        ORDER BY m.symbol`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      contracts: rows.map((row) => ({
        id: row.market_id,
        symbol: row.symbol,
        baseAsset: row.base_asset,
        quoteAsset: row.quote_asset,
        settlementAsset: row.settlement_asset,
        contract_type: row.contract_type,
        listingType: row.listing_type,
        contract_size: row.contract_size,
        tick_size: row.tick_size,
        price_precision: row.price_precision,
        quantity_precision: row.quantity_precision,
        min_quantity: row.min_quantity,
        max_quantity: row.max_quantity,
        max_leverage: row.max_leverage,
        maker_fee_bps: row.maker_fee_bps,
        taker_fee_bps: row.taker_fee_bps,
        fundingIntervalHours: row.funding_interval_hours,
        funding_rate: row.funding_rate ?? null,
        mark_price: row.mark_price ?? null,
        index_price: row.index_price ?? null,
        fundingTimeNs: row.funding_time_ns ?? null,
        deliveryTimeNs: row.delivery_time_ns ?? null,
        status: row.status,
      })),
    },
    { headers: NO_STORE },
  );
}
