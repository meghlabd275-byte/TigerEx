import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { portfolioSummary } from '@/lib/db/portfolio';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's portfolio allocation by asset.
 *
 * Each allocation is a holding's real USD value as a fraction of the priced
 * total; an asset with no listed price is excluded from the percentages and
 * reported separately, so the allocation always sums to one over priced assets.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const summary = portfolioSummary(auth.user.userId);
  const priced = summary.holdings.filter((holding) => holding.usdValue !== null && holding.usdValue > 0);
  const total = priced.reduce((sum, holding) => sum + (holding.usdValue ?? 0), 0);

  const allocations = priced
    .map((holding) => ({
      asset: holding.coin,
      value: holding.usdValue ?? 0,
      percentage: total > 0 ? ((holding.usdValue ?? 0) / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const data = { allocations, totalValue: total, unpricedAssets: summary.unpricedAssets };
  return NextResponse.json({ success: true, ...data, data }, { headers: NO_STORE });
}
