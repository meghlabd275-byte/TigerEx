import { NextResponse } from 'next/server';
import { listedMarkets } from '@/lib/trading/market-view';
import { NO_STORE } from '@/lib/api/route-guards';

// This handler reads live state on every request. Without an explicit
// dynamic marker Next.js would prerender it once at build time and serve
// that frozen response forever, so the client would never see a market it
// just listed or a trade it just settled.
export const dynamic = 'force-dynamic';

/**
 * The exchange's listed markets.
 *
 * Each entry carries the listing metadata and the live 24-hour statistics from
 * this venue's own trade tape. A market that has not traded yet reports a null
 * price and a zero volume rather than a seeded quote.
 */
export async function GET() {
  const markets = listedMarkets();
  return NextResponse.json({ success: true, data: markets, markets }, { headers: NO_STORE });
}
