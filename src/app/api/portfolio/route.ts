import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { portfolioSummary } from '@/lib/db/portfolio';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Portfolio positions for the authenticated user.
 *
 * Each position is a holding valued at the venue's own market price, with the
 * realized P&L attributed to it. An asset with no listed price is reported with
 * a null value rather than being valued at an invented rate, and is excluded
 * from the total.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    const summary = portfolioSummary(auth.user.userId);

    const positions = summary.holdings.map((holding) => ({
      symbol: holding.coin,
      amount: holding.available + holding.locked,
      value: holding.usdValue,
      pnl: summary.realizedPnlUSDT,
      pnlPercent: null,
    }));

    return NextResponse.json(
      {
        success: true,
        data: {
          positions,
          totalValue: summary.totalBalanceUSDT,
          totalPnL: summary.realizedPnlUSDT,
          totalPnLPercent: null,
          realizedPnl24h: summary.realizedPnl24hUSDT,
          unrealizedPnl: summary.unrealizedPnlUSDT,
          openOrders: summary.openOrders,
          unpricedAssets: summary.unpricedAssets,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error('Portfolio API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
