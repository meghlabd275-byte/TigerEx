import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listMarginLoans } from '@/lib/trading/margin-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Collateral posted against the caller's loans.
 *
 * A loan with no priceable collateral is reported with a null value and
 * `liquidatable: null` rather than a fabricated health figure.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const loans = listMarginLoans(auth.user.userId);
  return NextResponse.json(
    {
      success: true,
      collateral: loans.map((loan) => ({
        loanId: loan.loanId,
        symbol: loan.symbol,
        collateralAsset: loan.collateralAsset,
        collateralAmount: loan.collateralAmount,
        collateralValue: loan.collateralValue,
        liquidationThreshold: loan.liquidationThreshold,
        ltv: loan.ltv,
        healthRatio: loan.healthRatio,
        liquidatable: loan.liquidatable,
      })),
    },
    { headers: NO_STORE },
  );
}
