import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { portfolioSummary } from '@/lib/db/portfolio';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's balances available for P2P trading.
 *
 * A P2P trade settles from the spot wallet, so the tradable balance is the
 * account's own available balance per asset, valued at the venue's price. An
 * asset with no listed price is reported with a null value rather than an
 * invented one.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const summary = portfolioSummary(auth.user.userId);
  const balances = summary.holdings.map((holding) => ({
    asset: holding.coin,
    available: holding.available,
    locked: holding.locked,
    usdPrice: holding.usdPrice,
    usdValue: holding.usdValue,
  }));

  const data = {
    balances,
    totalAvailableUSDT: balances.reduce(
      (sum, balance) => sum + (balance.usdPrice !== null ? balance.available * balance.usdPrice : 0),
      0,
    ),
    unpricedAssets: summary.unpricedAssets,
  };

  return NextResponse.json({ success: true, ...data, data }, { headers: NO_STORE });
}
