import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { dexFailure } from '@/lib/dex/route-helpers';
import { NO_STORE } from '@/lib/api/route-guards';

// This handler reads live state on every request. Without an explicit
// dynamic marker Next.js would prerender it once at build time and serve
// that frozen response forever, so the client would never see a pool it
// just created, a swap it just settled, or the current server time.
export const dynamic = 'force-dynamic';

/** The protocol's DEX revenue ledger, grouped by source. */
export async function GET(_request: NextRequest) {
  try {
    const bySource = getDb()
      .prepare(
        `SELECT source, asset, COALESCE(SUM(amount), 0) AS total,
                COALESCE(SUM(lp_share), 0) AS lp, COALESCE(SUM(vetgr_share), 0) AS vetgr,
                COALESCE(SUM(treasury_share), 0) AS treasury, COALESCE(SUM(insurance_share), 0) AS insurance,
                COALESCE(SUM(burn_share), 0) AS burn
           FROM dex_revenue_ledger GROUP BY source, asset ORDER BY total DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    const recent = getDb()
      .prepare('SELECT * FROM dex_revenue_ledger ORDER BY created_at DESC LIMIT 100')
      .all() as Array<Record<string, unknown>>;
    return NextResponse.json({ success: true, bySource, recent }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
