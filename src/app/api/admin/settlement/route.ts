import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { runSettlementCycle } from '@/lib/trading/settlement';

/**
 * Run one settlement cycle from the admin console.
 *
 * Funding, option expiry and leveraged-token rebalancing are time-driven venue
 * actions. The scheduler calls `POST /api/settlement` with the keeper secret;
 * an operator can trigger the same cycle here, and every run is audited.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  // Recent funding settlements, newest first, so an operator can see the venue's
  // own funding history rather than a placeholder.
  const funding = getDb()
    .prepare(
      `SELECT symbol, funding_rate, mark_price, index_price, premium, funding_time_ns, created_at
         FROM funding_rates ORDER BY funding_time_ns DESC LIMIT 200`,
    )
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json({ success: true, funding }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.settlement');
  if (guard) return guard;

  try {
    const report = runSettlementCycle();
    recordAdminAction(request, auth.admin, 'settlement.run', {
      type: 'settlement_cycle',
      detail: {
        funding: report.fundingApplied.length,
        options: report.optionsSettled.length,
        etf: report.etfRebalanced.length,
        redPacketsRefunded: report.redPacketsRefunded,
        botsRun: report.botsRun,
        botsPlaced: report.botsPlaced,
        copyMirrored: report.copyMirrored,
        copySkipped: report.copySkipped,
        adlContracts: report.adlContracts.length,
        adlClawedBack: report.adlClawedBack,
      },
    });
    return NextResponse.json({ success: true, report }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Settlement cycle failed';
    return fail('SETTLEMENT_FAILED', message, 500);
  }
}
