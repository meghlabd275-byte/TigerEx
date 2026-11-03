import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fail, symbolParam, NO_STORE } from '@/lib/api/route-guards';

/**
 * Leverage brackets for a market.
 *
 * Reads the exchange's own `risk_limits` table. The execution path uses the
 * same rows to cap a position's leverage, so a client that shows these brackets
 * shows exactly what the risk engine will enforce.
 */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) return fail('VALIDATION_FAILED', 'A symbol such as BTC/RUSD is required');

  const rows = getDb()
    .prepare('SELECT tier, max_position_notional, max_leverage, maintenance_margin_rate FROM risk_limits WHERE symbol = ? ORDER BY tier')
    .all(symbol) as Array<{
    tier: number;
    max_position_notional: number;
    max_leverage: number;
    maintenance_margin_rate: number;
  }>;

  return NextResponse.json(
    {
      success: true,
      symbol,
      brackets: rows.map((row) => ({
        tier: row.tier,
        maxPositionNotional: row.max_position_notional,
        maxLeverage: row.max_leverage,
        maintenanceMarginRate: row.maintenance_margin_rate,
      })),
    },
    { headers: NO_STORE },
  );
}
