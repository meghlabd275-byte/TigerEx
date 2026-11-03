import { NextRequest, NextResponse } from 'next/server';
import { recentTrades, lastTradePrice } from '@/lib/trading/market-view';
import { NO_STORE, symbolParam } from '@/lib/api/route-guards';

/**
 * Recent settled trades for a symbol.
 *
 * Reads the exchange's own `spot_trades` tape; an untraded symbol returns an
 * empty list and a null last price rather than a placeholder price.
 */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_FAILED', message: 'A symbol such as BTC/RUSD is required' } },
      { status: 400 },
    );
  }

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const trades = recentTrades(symbol, Number.isFinite(limit) ? limit : 100);

  return NextResponse.json(
    { success: true, symbol, lastPrice: lastTradePrice(symbol), trades },
    { headers: NO_STORE },
  );
}
