import { NextRequest } from 'next/server';
import { recentTrades } from '@/lib/trading/market-view';
import { symbolParam } from '@/lib/api/route-guards';
import { v1Error, v1Ok } from '@/lib/api/v1-guard';

/** Recent settled public trades for a symbol, newest first. */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) return v1Error('VALIDATION_FAILED', 'symbol must look like BTC/RUSD');

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  return v1Ok({ symbol, trades: recentTrades(symbol, limit) });
}
