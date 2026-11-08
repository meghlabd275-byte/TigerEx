import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listPositions, tradeHistory } from '@/lib/trading/etf-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's leveraged-token portfolio.
 *
 * Each holding is marked at its market's live NAV, so the value and unrealized
 * P&L move with the underlying rather than with a stored price.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const positions = listPositions(auth.user.userId);
  const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const records = tradeHistory(auth.user.userId, 100);

  const portfolio = { positions, totalValue, unrealizedPnl, records };
  return NextResponse.json({ success: true, portfolio, data: portfolio }, { headers: NO_STORE });
}
