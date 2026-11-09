import { NextRequest } from 'next/server';
import { listPools } from '@/lib/dex/swap-service';
import { dexOk, dexFailure } from '@/lib/dex/route-helpers';

// This handler reads live state on every request. Without an explicit
// dynamic marker Next.js would prerender it once at build time and serve
// that frozen response forever, so the client would never see a pool it
// just created, a swap it just settled, or the current server time.
export const dynamic = 'force-dynamic';

/**
 * List every TigerSwap pool with its live reserves, TVL and 24-hour volume.
 *
 * The numbers come from the pool rows and the settled swaps, so the list is the
 * venue's own state rather than a mirror of an external feed.
 */
export async function GET(_request: NextRequest) {
  try {
    return dexOk({ pools: listPools() });
  } catch (error) {
    return dexFailure(error);
  }
}
