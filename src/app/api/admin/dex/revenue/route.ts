import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * DEX revenue administration.
 *
 * Reports the fee ledger grouped by source and the treasury and insurance
 * balances the settlement path credits, all from real rows.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const bySource = db
    .prepare(
      `SELECT source, asset, COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(lp_share), 0) AS lp,
              COALESCE(SUM(vetgr_share), 0) AS vetgr, COALESCE(SUM(treasury_share), 0) AS treasury,
              COALESCE(SUM(insurance_share), 0) AS insurance, COALESCE(SUM(burn_share), 0) AS burn
         FROM dex_revenue_ledger GROUP BY source, asset ORDER BY total DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  const treasury = db
    .prepare("SELECT asset, account_type, balance FROM treasury_accounts WHERE account_type LIKE 'dex_%' ORDER BY asset")
    .all() as Array<Record<string, unknown>>;
  const insurance = db.prepare("SELECT * FROM insurance_funds WHERE contract LIKE 'dex%'").all() as Array<Record<string, unknown>>;

  return NextResponse.json({ success: true, bySource, treasury, insurance }, { headers: NO_STORE });
}
