import { NextRequest, NextResponse } from 'next/server';
import { listCopyTraders, getCopyTrader } from '@/lib/trading/copy-engine';
import { NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * Copy-trading leaders.
 *
 * The board is the exchange's own approved leaders, with each leader's ROI,
 * win rate and trade count recomputed live from their settled trades and closed
 * positions. An empty result means no leader has been approved yet, not that a
 * backend is missing.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const traderId = params.get('traderId') ?? params.get('id');

  if (traderId) {
    const trader = getCopyTrader(traderId);
    if (!trader) return fail('UNKNOWN_TRADER', 'No such copy trader', 404);
    return NextResponse.json({ success: true, trader, data: trader }, { headers: NO_STORE });
  }

  const limit = Number(params.get('limit') ?? 50);
  const sortBy = params.get('sortBy') ?? 'profit';
  const traders = listCopyTraders({ limit: Number.isFinite(limit) ? limit : 50, sortBy });

  return NextResponse.json({ success: true, traders, data: traders }, { headers: NO_STORE });
}
