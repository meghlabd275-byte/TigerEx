import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listPositions } from '@/lib/options/options-engine';
import { portfolioSummary } from '@/lib/db/portfolio';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's options account summary.
 *
 * Position value and unrealized P&L are marked from the model premium; the
 * settlement-asset balance is the real wallet balance, so the account summary
 * reconciles with the portfolio view.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const positions = listPositions(auth.user.userId);
  const positionValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const realizedPnl = listPositions(auth.user.userId, { status: 'settled' })
    .concat(listPositions(auth.user.userId, { status: 'closed' }))
    .reduce((sum, p) => sum + p.realizedPnl, 0);
  const portfolio = portfolioSummary(auth.user.userId);

  const account = {
    positionValue,
    unrealizedPnl,
    realizedPnl,
    openPositions: positions.length,
    totalBalanceUSDT: portfolio.totalBalanceUSDT,
    positions,
  };

  return NextResponse.json({ success: true, account, data: account }, { headers: NO_STORE });
}
