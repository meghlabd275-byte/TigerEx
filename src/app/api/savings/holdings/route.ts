import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userHoldings } from '@/lib/earn/holdings';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's earn and staking holdings.
 *
 * Read from the exchange's own `earn_subscriptions` joined to the product, with
 * the reward accrued from the product's APR and the real elapsed time.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status')?.trim().toLowerCase();
  const holdings = userHoldings(auth.user.userId, status ? { status } : {});

  return NextResponse.json({ success: true, holdings, data: holdings }, { headers: NO_STORE });
}
