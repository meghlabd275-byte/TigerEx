import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { dexFailure } from '@/lib/dex/route-helpers';
import { NO_STORE } from '@/lib/api/route-guards';
import { traderLeaderboard, whaleAlerts, smartMoneySignals } from '@/lib/dex/intelligence';

// The leaderboard, whale feed and smart-money signal all read settled rows on
// every request, so the handler must not be prerendered.
export const dynamic = 'force-dynamic';

/**
 * TigerSwap trading intelligence, computed from the venue's own settled rows.
 *
 * The leaderboard ranks traders by realised profit, the whale feed surfaces
 * swaps whose priced value passes a threshold, and the smart-money signal
 * aggregates recent flow per asset. Every figure comes from a swap or a closed
 * position the venue booked; an asset the venue cannot price is omitted rather
 * than valued at zero.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  try {
    const limit = Number(params.get('limit') ?? 25);
    const threshold = Number(params.get('threshold') ?? 10_000);
    const windowDays = Number(params.get('windowDays') ?? 1);
    const leaderboard = traderLeaderboard(limit);
    const whales = whaleAlerts(threshold);
    const signals = smartMoneySignals(windowDays);
    return NextResponse.json({ success: true, leaderboard, whales, signals }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
