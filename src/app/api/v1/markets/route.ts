import { NextRequest } from 'next/server';
import { listedMarkets } from '@/lib/trading/market-view';
import { v1Ok } from '@/lib/api/v1-guard';

// This handler reads live state on every request. Without an explicit
// dynamic marker Next.js would prerender it once at build time and serve
// that frozen response forever, so the client would never see a market it
// just listed or a trade it just settled.
export const dynamic = 'force-dynamic';

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
