import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';
import { buildReservesReport, runReconciliation } from '@/lib/compliance/reserves';

/**
 * Admin proof-of-reserves and reconciliation view.
 *
 * The reconciliation compares each asset's user liabilities against the holdings
 * recorded in the treasury accounts and fails closed when any asset is
 * under-collateralised. It is read-only: it never adjusts a balance.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const report = buildReservesReport();
  const reconciliation = runReconciliation();

  return NextResponse.json(
    {
      success: true,
      merkleRoot: report.merkleRoot,
      generatedAt: report.generatedAt,
      leafCount: report.leafCount,
      liabilities: report.assets,
      reconciliation,
    },
    { headers: NO_STORE },
  );
}
