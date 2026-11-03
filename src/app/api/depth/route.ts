import { NextRequest, NextResponse } from 'next/server';
import { orderBookDepth } from '@/lib/trading/market-view';
import { NO_STORE, symbolParam } from '@/lib/api/route-guards';

/**
 * Order book depth.
 *
 * Aggregated from the exchange's own open orders, so the levels a client sees
 * are the resting liquidity of this venue. An unknown or empty book returns
 * empty levels rather than a fabricated spread.
 */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_FAILED', message: 'A symbol such as BTC/RUSD is required' } },
      { status: 400 },
    );
  }

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 20);
  const depth = orderBookDepth(symbol, Number.isFinite(limit) ? limit : 20);

  return NextResponse.json(
    {
      success: true,
      symbol: depth.symbol,
      bids: depth.bids,
      asks: depth.asks,
      bestBid: depth.bestBid,
      bestAsk: depth.bestAsk,
      midPrice: depth.midPrice,
      lastPrice: depth.lastPrice,
    },
    { headers: NO_STORE },
  );
}
