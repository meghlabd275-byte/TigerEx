import { NextRequest } from 'next/server';
import { listedMarkets } from '@/lib/trading/market-view';
import { v1Ok } from '@/lib/api/v1-guard';

/**
 * Public markets directory.
 *
 * Unauthenticated, like every market-data endpoint: it exposes only listed
 * instruments and their live statistics, never account state.
 */
export async function GET(request: NextRequest) {
  void request;
  return v1Ok({ markets: listedMarkets() });
}
