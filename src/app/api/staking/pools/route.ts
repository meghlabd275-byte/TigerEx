import { NextResponse } from 'next/server';
import { stakingPools } from '@/lib/earn/rewards';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Active staking pools.
 *
 * The total staked per pool is the sum of its live subscriptions, so the figure
 * is the exchange's real position rather than a display value.
 */
export async function GET() {
  const pools = stakingPools();
  return NextResponse.json({ success: true, pools, data: pools }, { headers: NO_STORE });
}
