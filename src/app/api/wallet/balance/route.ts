import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { portfolioSummary } from '@/lib/db/portfolio';

/**
 * Get Wallet Balance
 *
 * Returns the authenticated user's balances with a USD valuation derived from
 * the live `market_data` table. Assets with no listed price are reported as
 * unpriced and excluded from the total instead of being valued at an invented
 * rate.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    const summary = portfolioSummary(auth.user.userId);
    return NextResponse.json(
      {
        success: true,
        balances: summary.holdings.map((holding) => ({
          coin: holding.coin,
          free: holding.available,
          locked: holding.locked,
          usdPrice: holding.usdPrice,
          usdValue: holding.usdValue,
        })),
        totalUSDT: summary.totalBalanceUSDT,
        unpricedAssets: summary.unpricedAssets,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Balance API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
