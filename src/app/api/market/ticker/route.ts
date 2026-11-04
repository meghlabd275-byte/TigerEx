import { NextRequest, NextResponse } from 'next/server';
import { orderBookDepth, rolling24h } from '@/lib/trading/market-view';
import { symbolParam, NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * 24-hour ticker for a symbol.
 *
 * Computed from this venue's own settled trades and resting orders: the price
 * change and volume come from the trade tape, the best bid and ask from the
 * live book. A symbol with no trades in the window is refused rather than
 * answered with an invented price.
 */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) {
    return fail('VALIDATION_FAILED', 'A symbol such as BTC/RUSD is required');
  }

  const stats = rolling24h(symbol);
  if (!stats) {
    return fail('NO_TRADING_DATA', `${symbol} has no trades in the last 24 hours`, 404);
  }

  const book = orderBookDepth(symbol, 1);
  const ticker = {
    symbol,
    price: stats.lastPrice,
    last: stats.lastPrice,
    open: stats.openPrice,
    high: stats.high,
    low: stats.low,
    volume: stats.volume,
    quoteVolume: stats.quoteVolume,
    priceChange: stats.priceChange,
    priceChangePercent: stats.priceChangePercent,
    change24h: stats.priceChange,
    changePercent24h: stats.priceChangePercent,
    bid: book.bestBid,
    ask: book.bestAsk,
    tradesCount: stats.trades,
    timestamp: Date.now(),
  };

  return NextResponse.json({ success: true, ...ticker, data: ticker }, { headers: NO_STORE });
}
