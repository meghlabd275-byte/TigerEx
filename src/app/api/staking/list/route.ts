import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userHoldings } from '@/lib/earn/holdings';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's active staking positions.
 *
 * A staking position is an earn subscription; the view is the same data the
 * savings view reads, scoped to the caller's own rows.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const stakes = userHoldings(auth.user.userId, { status: 'active' }).map((holding) => ({
    id: holding.id,
    pool_id: holding.product_id,
    product_id: holding.product_id,
    symbol: holding.symbol,
    asset: holding.asset,
    amount: holding.amount,
    rewards: holding.rewards,
    apy: holding.apy,
    status: holding.status,
    created_at: holding.created_at,
  }));

  return NextResponse.json({ success: true, stakes, data: stakes }, { headers: NO_STORE });
}
