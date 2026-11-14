import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { marketMakerStatus } from '@/lib/trading/venue-market-maker';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Venue market-maker status for an authenticated client.
 *
 * This is the venue's own desk, so the figures are the venue's public liquidity
 * state (spread, quoted size, live inventory), not a user's account. It is
 * served same-origin from the venue's own database; there is no backend hop.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json({ success: true, markets: marketMakerStatus() }, { headers: NO_STORE });
}
