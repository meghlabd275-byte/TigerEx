import { NextRequest, NextResponse } from 'next/server';
import { candlesFor, SUPPORTED_INTERVALS } from '@/lib/trading/candles';
import { symbolParam, NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * Candlestick history for a symbol.
 *
 * The candles are aggregated from this venue's own settled trades, so the chart
 * reflects real trading rather than a mirrored feed. A symbol with no trades in
 * the window returns an empty series.
 */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) {
    return fail('VALIDATION_FAILED', 'A symbol such as BTC/RUSD is required');
  }

  const interval = (request.nextUrl.searchParams.get('interval') ?? '1m').trim().toLowerCase();
  if (!SUPPORTED_INTERVALS.includes(interval)) {
    return fail('VALIDATION_FAILED', `interval must be one of ${SUPPORTED_INTERVALS.join(', ')}`);
  }

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const candles = candlesFor(symbol, interval, Number.isFinite(limit) ? limit : 100);

  return NextResponse.json(
    {
      success: true,
      symbol,
      interval,
      candles,
      // The positional form is what a charting client expects: time in seconds,
      // then open, high, low, close and volume.
      data: candles.map((candle) => [
        candle.time,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
      ]),
    },
    { headers: NO_STORE },
  );
}
