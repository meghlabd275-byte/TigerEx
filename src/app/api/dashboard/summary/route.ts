import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { portfolioSummary } from '@/lib/db/portfolio';
import { listPositions as listOptionsPositions } from '@/lib/options/options-engine';
import { listPositions as listEtfPositions } from '@/lib/trading/etf-engine';
import { listUserBots } from '@/lib/bots/instances';
import { unreadCount } from '@/lib/notifications/inbox';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's dashboard summary.
 *
 * Every figure is read from the exchange's own rows: the portfolio total and
 * P&L from `portfolioSummary`, the options and leveraged-token marks from their
 * engines, and the bot and notification counts from their tables. An account
 * with no positions reports zeros rather than placeholder activity.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const portfolio = portfolioSummary(auth.user.userId);
  const optionsPositions = listOptionsPositions(auth.user.userId);
  const etfPositions = listEtfPositions(auth.user.userId);
  const bots = listUserBots(auth.user.userId);

  // Available and locked USD values are the holdings' own balances valued at
  // their listed prices; an unpriced asset contributes nothing to either.
  const availableBalanceUSDT = portfolio.holdings.reduce(
    (sum, holding) => sum + (holding.usdPrice !== null ? holding.available * holding.usdPrice : 0),
    0,
  );
  const lockedBalanceUSDT = portfolio.holdings.reduce(
    (sum, holding) => sum + (holding.usdPrice !== null ? holding.locked * holding.usdPrice : 0),
    0,
  );

  const summary = {
    totalBalanceUSDT: portfolio.totalBalanceUSDT,
    availableBalanceUSDT,
    lockedBalanceUSDT,
    realizedPnlUSDT: portfolio.realizedPnlUSDT,
    unrealizedPnlUSDT: portfolio.unrealizedPnlUSDT,
    openOrders: portfolio.openOrders,
    holdings: portfolio.holdings,
    unpricedAssets: portfolio.unpricedAssets,
    options: {
      openPositions: optionsPositions.length,
      positionValue: optionsPositions.reduce((sum, position) => sum + position.marketValue, 0),
      unrealizedPnl: optionsPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0),
    },
    leveragedTokens: {
      holdings: etfPositions.length,
      value: etfPositions.reduce((sum, position) => sum + position.marketValue, 0),
      unrealizedPnl: etfPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0),
    },
    bots: {
      total: bots.length,
      running: bots.filter((bot) => bot.status === 'running').length,
    },
    unreadNotifications: unreadCount(auth.user.userId),
  };

  return NextResponse.json({ success: true, summary, data: summary }, { headers: NO_STORE });
}
