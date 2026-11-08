import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { kycLimits, limitForLevel, withdrawalUsage } from '@/lib/wallet/withdrawals';
import { usdPrice } from '@/lib/db/portfolio';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's withdrawal limits and current usage.
 *
 * The tiers are the operator's configured `kyc_limit_level_<n>` settings, and
 * the usage is measured from the account's own paid-out withdrawals, so the
 * remaining quota a user sees is the quota the withdrawal path will enforce.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const user = auth.user;
  const kycLevel = String((user as { kycLevel?: string; kyc_level?: string }).kycLevel ?? (user as { kyc_level?: string }).kyc_level ?? 'none');
  const usage = withdrawalUsage(user.userId, kycLevel, usdPrice);
  const tier = limitForLevel(kycLevel);

  const limits = {
    kycLevel,
    tier,
    tiers: kycLimits(),
    usage,
  };

  return NextResponse.json({ success: true, limits, data: limits }, { headers: NO_STORE });
}
