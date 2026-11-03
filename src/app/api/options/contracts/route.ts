import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Listed options contracts.
 *
 * Reads the exchange's own `options_markets` table. Every row was created
 * through the admin listing console, so an empty result means no contract has
 * been listed, not that a backend is missing.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const underlying = searchParams.get('underlying')?.trim().toUpperCase();
  const optionType = searchParams.get('type')?.trim().toLowerCase();
  const settlement = searchParams.get('settlement')?.trim().toUpperCase();

  const clauses: string[] = [];
  const params: string[] = [];
  if (underlying) {
    clauses.push('underlying = ?');
    params.push(underlying);
  }
  if (optionType) {
    clauses.push('option_type = ?');
    params.push(optionType);
  }
  if (settlement) {
    clauses.push('settlement_asset = ?');
    params.push(settlement);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM options_markets${where} ORDER BY underlying, expiry_ns, strike_price`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      contracts: rows.map((row) => ({
        marketId: row.market_id,
        symbol: row.symbol,
        underlying: row.underlying,
        settlementAsset: row.settlement_asset,
        optionType: row.option_type,
        strikePrice: row.strike_price,
        expiryNs: row.expiry_ns,
        exerciseStyle: row.exercise_style,
        contractSize: row.contract_size,
        tickSize: row.tick_size,
        minQuantity: row.min_quantity,
        maxQuantity: row.max_quantity,
        makerFeeBps: row.maker_fee_bps,
        takerFeeBps: row.taker_fee_bps,
        impliedVolatility: row.implied_volatility ?? null,
        status: row.status,
      })),
    },
    { headers: NO_STORE },
  );
}
