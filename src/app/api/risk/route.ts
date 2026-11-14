import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { NO_STORE, symbolParam } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Published leverage brackets.
 *
 * The tiers are the exchange's own `risk_limits` rows: the same rows the risk
 * engine reads to set a position's maximum leverage and maintenance margin. A
 * symbol with no tiers is returned as an empty list, because such a market
 * cannot be traded.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('symbol');
  const symbol = raw ? symbolParam(raw) : null;
  if (raw && !symbol) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_FAILED', message: 'symbol must look like BTC/RUSD' } },
      { status: 400 },
    );
  }

  const db = getDb();
  const rows = (symbol
    ? db.prepare('SELECT * FROM risk_limits WHERE symbol = ? ORDER BY tier').all(symbol)
    : db.prepare('SELECT * FROM risk_limits ORDER BY symbol, tier').all()) as Array<Record<string, unknown>>;

  const limits = rows.map((row) => ({
    symbol: row.symbol,
    tier: Number(row.tier),
    maxPositionNotional: Number(row.max_position_notional),
    max_position_notional: Number(row.max_position_notional),
    maxLeverage: Number(row.max_leverage),
    max_leverage: Number(row.max_leverage),
    maintenanceMarginRate: Number(row.maintenance_margin_rate),
    maintenance_margin_rate: Number(row.maintenance_margin_rate),
  }));

  return NextResponse.json({ success: true, limits, data: limits }, { headers: NO_STORE });
}
