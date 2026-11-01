import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { portfolioSummary } from '@/lib/db/portfolio';

/**
 * Portfolio summary for the authenticated user.
 *
 * Holdings, their USD valuation and realized P&L are computed from the
 * exchange's own ledger (balances, market_data, order_history). Assets with no
 * listed price are returned with a null value and listed in `unpricedAssets`
 * instead of being valued at an invented rate.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    const summary = portfolioSummary(auth.user.userId);
    return NextResponse.json(
      { success: true, data: summary },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Portfolio summary error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
