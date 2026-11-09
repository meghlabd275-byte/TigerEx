import { NextRequest } from 'next/server';
import { poolDetail } from '@/lib/dex/swap-service';
import { dexOk, dexFailure } from '@/lib/dex/route-helpers';

/** A pool's detail: reserves, TVL and its most recent swaps. */
export async function GET(_request: NextRequest, context: { params: { poolId: string } }) {
  try {
    return dexOk({ pool: poolDetail(context.params.poolId) });
  } catch (error) {
    return dexFailure(error);
  }
}
