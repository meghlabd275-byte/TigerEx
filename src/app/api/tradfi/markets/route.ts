import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { lastTradePrice } from '@/lib/trading/market-view';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Listed TradFi instruments.
 *
 * Stocks, FX, commodities and indices, read from the exchange's own
 * `tradfi_markets` table. The last price comes from the venue's own trade tape
 * for the instrument, so an instrument that has not traded reports a null price
 * rather than an invented one.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const instrumentType = searchParams.get('type')?.trim().toLowerCase();
  const status = searchParams.get('status')?.trim().toLowerCase();

  const clauses: string[] = [];
  const params: string[] = [];
  if (instrumentType) {
    clauses.push('instrument_type = ?');
    params.push(instrumentType);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  } else {
    clauses.push("status = 'active'");
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM tradfi_markets${where} ORDER BY instrument_type, symbol`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      markets: rows.map((row) => {
        const symbol = String(row.symbol);
        return {
          id: row.market_id,
          marketId: row.market_id,
          symbol: row.symbol,
          instrumentType: row.instrument_type,
          settlementAsset: row.settlement_asset,
          priceSource: row.price_source,
          referenceSymbol: row.reference_symbol,
          tickSize: row.tick_size,
          minQuantity: row.min_quantity,
          maxQuantity: row.max_quantity,
          maxLeverage: row.max_leverage,
          makerFeeBps: row.maker_fee_bps,
          takerFeeBps: row.taker_fee_bps,
          tradingHours: row.trading_hours,
          lastPrice: lastTradePrice(symbol),
          status: row.status,
        };
      }),
    },
    { headers: NO_STORE },
  );
}
