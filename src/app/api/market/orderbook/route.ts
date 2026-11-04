import { NextRequest, NextResponse } from 'next/server';
import { orderBookDepth } from '@/lib/trading/market-view';
import { symbolParam, NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * Order book depth for a symbol.
 *
 * Aggregated from this venue's own resting orders, so the levels are the real
 * liquidity of the exchange. An empty or unknown book returns empty levels
 * rather than a fabricated spread.
 */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) {
    return fail('VALIDATION_FAILED', 'A symbol such as BTC/RUSD is required');
  }

  const requested = Number(request.nextUrl.searchParams.get('limit') ?? 20);
  const depth = orderBookDepth(symbol, Number.isFinite(requested) ? requested : 20);
  const spread = depth.bestBid !== null && depth.bestAsk !== null ? depth.bestAsk - depth.bestBid : 0;

  return NextResponse.json(
    {
      success: true,
      symbol: depth.symbol,
      // The panel renders objects; a charting client wants the positional form,
      // which is provided under `data` for the same request.
      bids: depth.bids.map((level) => ({ price: level.price, amount: level.quantity, total: level.total })),
      asks: depth.asks.map((level) => ({ price: level.price, amount: level.quantity, total: level.total })),
      data: {
        bids: depth.bids.map((level) => [level.price, level.quantity]),
        asks: depth.asks.map((level) => [level.price, level.quantity]),
      },
      bestBid: depth.bestBid,
      bestAsk: depth.bestAsk,
      midPrice: depth.midPrice,
      lastPrice: depth.lastPrice,
      spread,
    },
    { headers: NO_STORE },
  );
}
