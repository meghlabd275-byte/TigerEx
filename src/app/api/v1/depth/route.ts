import { NextRequest } from 'next/server';
import { orderBookDepth } from '@/lib/trading/market-view';
import { symbolParam } from '@/lib/api/route-guards';
import { v1Error, v1Ok } from '@/lib/api/v1-guard';

/** Order-book depth for a symbol, aggregated from the venue's own open orders. */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) return v1Error('VALIDATION_FAILED', 'symbol must look like BTC/RUSD');

  const levels = Number(request.nextUrl.searchParams.get('limit') ?? 20);
  return v1Ok({ book: orderBookDepth(symbol, levels) });
}
