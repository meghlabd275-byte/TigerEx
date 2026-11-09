import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runKeeperCycle } from '@/lib/dex/keeper';
import { dexFailure } from '@/lib/dex/route-helpers';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Run one TigerSwap keeper cycle: settle due limit orders, run due DCA and TWAP
 * slices, apply perpetual funding and liquidate positions below maintenance.
 *
 * The endpoint is guarded by a shared secret rather than a trader session,
 * because it is called by the scheduler, not by a person. Without
 * `TIGEREX_KEEPER_SECRET` configured the route fails closed, so an unconfigured
 * deployment never exposes an unauthenticated way to move funds.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.TIGEREX_KEEPER_SECRET;
  if (!secret || secret.length < 16) return false;
  const presented = request.headers.get('x-keeper-secret') ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Keeper secret required' } },
      { status: 401, headers: NO_STORE },
    );
  }
  try {
    return NextResponse.json({ success: true, report: runKeeperCycle() }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
