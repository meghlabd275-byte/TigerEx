import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { dexFailure } from '@/lib/dex/route-helpers';
import { NO_STORE } from '@/lib/api/route-guards';

// This handler reads live state on every request. Without an explicit
// dynamic marker Next.js would prerender it once at build time and serve
// that frozen response forever, so the client would never see a pool it
// just created, a swap it just settled, or the current server time.
export const dynamic = 'force-dynamic';

/**
 * TigerSwap overview.
 *
 * Returns the venue's own aggregates: pool count, TVL, 24-hour volume and fees,
 * and the number of listed tokens. All values come from real rows; a venue with
 * no pools reports zeros rather than a placeholder.
 */
export async function GET() {
  try {
    const db = getDb();
    const pools = db
      .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(tvl_usd), 0) AS tvl FROM dex_pools WHERE status = 'active'")
      .get() as { count: number; tvl: number };
    const swaps = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount_in), 0) AS volume, COALESCE(SUM(fee), 0) AS fees
           FROM dex_swaps WHERE created_at >= datetime('now', '-1 day')`,
      )
      .get() as { count: number; volume: number; fees: number };
    const tokens = db.prepare("SELECT COUNT(*) AS count FROM dex_tokens WHERE status = 'active'").get() as { count: number };

    return NextResponse.json(
      {
        success: true,
        dex: {
          activePools: pools.count,
          totalTvlUsd: pools.tvl,
          swaps24h: swaps.count,
          volume24hUsd: swaps.volume,
          fees24hUsd: swaps.fees,
          listedTokens: tokens.count,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}
