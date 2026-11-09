import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { fail, NO_STORE } from '@/lib/api/route-guards';
import { listHooks, evaluateHooks } from '@/lib/dex/hook-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap V4 hooks (read).
 *
 * `GET` lists the hooks attached to a pool, or evaluates them for the pool's
 * current state so an operator or a trader can see the fee a dynamic-fee hook
 * would charge before a swap arrives. This is read-only.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const poolId = params.get('poolId');
  try {
    if (!poolId) {
      return NextResponse.json({ success: true, hooks: listHooks() }, { headers: NO_STORE });
    }
    if (params.get('evaluate') === 'true') {
      const currentPrice = params.get('currentPrice');
      const side = params.get('side');
      const evaluation = evaluateHooks(poolId, {
        currentPrice: currentPrice === null ? undefined : Number(currentPrice),
        side: side === 'sell' ? 'sell' : side === 'buy' ? 'buy' : undefined,
      });
      return NextResponse.json({ success: true, evaluation }, { headers: NO_STORE });
    }
    if (!poolId) return fail('INVALID_POOL', 'poolId is required');
    return NextResponse.json({ success: true, hooks: listHooks(poolId) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
