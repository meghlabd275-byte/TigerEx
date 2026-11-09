import { NextResponse } from 'next/server';
import { exchangeStats } from '@/lib/trading/exchange-stats';

// This handler reads live state on every request. Without an explicit
// dynamic marker Next.js would prerender it once at build time and serve
// that frozen response forever, so the client would never see a pool it
// just created, a swap it just settled, or the current server time.
export const dynamic = 'force-dynamic';

/**
 * Exchange-wide statistics.
 *
 * Every figure is aggregated from TigerEx's own database. Nothing is
 * extrapolated or hardcoded: if the exchange has no trading history yet, the
 * counters are genuinely zero rather than an illustrative placeholder.
 */
export async function GET() {
  try {
    return NextResponse.json(
      { success: true, data: exchangeStats() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
