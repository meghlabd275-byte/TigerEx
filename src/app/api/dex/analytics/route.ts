import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { dexFailure } from '@/lib/dex/route-helpers';
import { NO_STORE } from '@/lib/api/route-guards';

// This handler reads live state on every request. Without an explicit
// dynamic marker Next.js would prerender it once at build time and serve
// that frozen response forever, so the client would never see a pool it
// just created, a swap it just settled, or the current server time.
export const dynamic = 'force-dynamic';

/**
 * TigerSwap analytics, computed from the venue's own rows.
 *
 * Everything here is aggregated from pools, settled swaps and the revenue
 * ledger, so the dashboard reflects real trading rather than a mirrored feed.
 */
export async function GET(_request: NextRequest) {
  try {
    const db = getDb();
    const pools = db
      .prepare("SELECT COUNT(*) AS pools, COALESCE(SUM(tvl_usd), 0) AS tvl FROM dex_pools WHERE status = 'active'")
      .get() as { pools: number; tvl: number };
    const swaps = db
      .prepare(
        `SELECT COUNT(*) AS swaps, COALESCE(SUM(amount_in), 0) AS volume, COALESCE(SUM(fee), 0) AS fees
           FROM dex_swaps WHERE created_at >= datetime('now', '-1 day')`,
      )
      .get() as { swaps: number; volume: number; fees: number };
    const perps = db
      .prepare("SELECT COUNT(*) AS positions, COALESCE(SUM(collateral), 0) AS collateral FROM dex_perp_positions WHERE status = 'open'")
      .get() as { positions: number; collateral: number };
    const lending = db
      .prepare('SELECT COALESCE(SUM(total_supply), 0) AS supplied, COALESCE(SUM(total_borrow), 0) AS borrowed FROM dex_lending_markets')
      .get() as { supplied: number; borrowed: number };
    const users = db.prepare('SELECT COUNT(DISTINCT user_id) AS users FROM dex_swaps').get() as { users: number };
    const revenue = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(lp_share), 0) AS lp,
                COALESCE(SUM(vetgr_share), 0) AS vetgr, COALESCE(SUM(treasury_share), 0) AS treasury,
                COALESCE(SUM(insurance_share), 0) AS insurance, COALESCE(SUM(burn_share), 0) AS burn
           FROM dex_revenue_ledger`,
      )
      .get() as Record<string, number>;

    return NextResponse.json(
      {
        success: true,
        overview: {
          totalPools: pools.pools,
          totalTvlUsd: pools.tvl,
          swaps24h: swaps.swaps,
          volume24hUsd: swaps.volume,
          fees24hUsd: swaps.fees,
          activeSwappers: users.users,
          openPerpPositions: perps.positions,
          perpCollateral: perps.collateral,
          totalSupplied: lending.supplied,
          totalBorrowed: lending.borrowed,
          revenue,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}
