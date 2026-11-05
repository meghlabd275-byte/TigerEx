import { NextRequest } from 'next/server';
import { listedMarkets, rolling24h } from '@/lib/trading/market-view';
import { symbolParam } from '@/lib/api/route-guards';
import { v1Error, v1Ok } from '@/lib/api/v1-guard';

/**
 * 24-hour ticker. With a `symbol` it returns that instrument; without one it
 * returns every listed instrument, computed from settled trades.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('symbol');
  if (raw === null) return v1Ok({ tickers: listedMarkets() });

  const symbol = symbolParam(raw);
  if (!symbol) return v1Error('VALIDATION_FAILED', 'symbol must look like BTC/RUSD');

  const stats = rolling24h(symbol);
  if (!stats) return v1Error('NO_MARKET_DATA', `${symbol} has no trades in the last 24 hours`, 404);
  return v1Ok({ symbol, ticker: stats });
}
