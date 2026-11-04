import { NextRequest, NextResponse } from 'next/server';
import { orderBookDepth, rolling24h, listedMarkets } from '@/lib/trading/market-view';
import { symbolParam, NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * 24-hour ticker statistics.
 *
 * With a symbol the response is that market's statistics; without one it is
 * every listed market. All of it is computed from this venue's own trade tape
 * and resting orders, so a market that has not traded reports a null price and
 * a zero volume rather than a seeded quote.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('symbol');

  if (raw !== null) {
    const symbol = symbolParam(raw);
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
      lastPrice: stats.lastPrice,
      price: stats.lastPrice,
      openPrice: stats.openPrice,
      open: stats.openPrice,
      highPrice: stats.high,
      high: stats.high,
      lowPrice: stats.low,
      low: stats.low,
      volume: stats.volume,
      quoteVolume: stats.quoteVolume,
      priceChange: stats.priceChange,
      priceChangePercent: stats.priceChangePercent,
      bid: book.bestBid,
      ask: book.bestAsk,
      tradesCount: stats.trades,
      closeTime: Date.now(),
    };

    return NextResponse.json({ success: true, ticker, data: ticker }, { headers: NO_STORE });
  }

  const tickers = listedMarkets().map((market) => ({
    symbol: market.symbol,
    lastPrice: market.lastPrice,
    price: market.lastPrice,
    highPrice: null,
    lowPrice: null,
    volume: market.volume24h,
    quoteVolume: market.quoteVolume24h,
    priceChangePercent: market.priceChangePercent24h,
    tradesCount: market.trades24h,
  }));

  return NextResponse.json({ success: true, ticker: tickers, data: tickers }, { headers: NO_STORE });
}
