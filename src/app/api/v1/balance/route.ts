import { NextRequest } from 'next/server';
import { requireApiKey, v1Ok } from '@/lib/api/v1-guard';
import { portfolioSummary } from '@/lib/db/portfolio';

/**
 * Account balances for the API-key's owner.
 *
 * Requires the `read` permission. Values are the real ledger balances; an asset
 * with no listed price is reported unpriced rather than valued at an invented
 * rate.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiKey(request, 'read', '');
  if ('error' in auth) return auth.error;

  const summary = portfolioSummary(auth.identity.userId);
  return v1Ok({
    balances: summary.holdings.map((holding) => ({
      coin: holding.coin,
      free: holding.available,
      locked: holding.locked,
      usdPrice: holding.usdPrice,
      usdValue: holding.usdValue,
    })),
    totalUSDT: summary.totalBalanceUSDT,
    unpricedAssets: summary.unpricedAssets,
  });
}
