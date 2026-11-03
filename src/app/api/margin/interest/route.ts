import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { listMarginLoans } from '@/lib/trading/margin-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Accrued interest on the caller's margin loans.
 *
 * Each figure is computed from the loan's own market interest model and the
 * time since it was last settled.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const loans = listMarginLoans(auth.user.userId);
  const totalInterest = loans.reduce((sum, loan) => sum + loan.interestAccrued, 0);

  return NextResponse.json(
    {
      success: true,
      totalInterest,
      loans: loans.map((loan) => ({
        loanId: loan.loanId,
        symbol: loan.symbol,
        asset: loan.asset,
        principal: loan.principal,
        interestAccrued: loan.interestAccrued,
        totalOwed: loan.totalOwed,
        ltv: loan.ltv,
        healthRatio: loan.healthRatio,
      })),
    },
    { headers: NO_STORE },
  );
}
