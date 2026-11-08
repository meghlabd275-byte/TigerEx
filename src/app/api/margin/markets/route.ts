import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Listed spot-margin markets.
 *
 * Reads the exchange's own `margin_markets` table, which the admin margin
 * listing console writes. Cross and isolated pools are separate rows on the
 * same pair, so `mode` selects between them. An empty result means no pool has
 * been listed, not that a backend is missing.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode')?.trim().toLowerCase();
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();
  const status = searchParams.get('status')?.trim().toLowerCase();

  const clauses: string[] = [];
  const params: string[] = [];
  if (mode) {
    clauses.push('mode = ?');
    params.push(mode);
  }
  if (symbol) {
    clauses.push('symbol = ?');
    params.push(symbol);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  } else {
    clauses.push("status = 'active'");
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM margin_markets${where} ORDER BY symbol, mode`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      markets: rows.map((row) => ({
        id: row.market_id,
        marketId: row.market_id,
        symbol: row.symbol,
        baseAsset: row.base_asset,
        quoteAsset: row.quote_asset,
        mode: row.mode,
        maxLeverage: row.max_leverage,
        collateralLtv: row.collateral_ltv,
        borrowableAssets: row.borrowable_assets,
        interestBaseApr: row.interest_base_apr,
        interestKinkUtilization: row.interest_kink_utilization,
        interestKinkApr: row.interest_kink_apr,
        interestMaxApr: row.interest_max_apr,
        liquidationThresholds: row.liquidation_thresholds,
        liquidationBonus: row.liquidation_bonus,
        riskTier: row.risk_tier,
        status: row.status,
      })),
    },
    { headers: NO_STORE },
  );
}
