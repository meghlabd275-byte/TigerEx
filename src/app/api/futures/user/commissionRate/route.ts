import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { futuresRates } from '@/lib/trading/spot-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's futures commission rate.
 *
 * Resolved through the same VIP tier function the fee engine calls when it
 * charges a fill, so the quoted rate is the rate that will be applied.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const rates = futuresRates(auth.user.userId);
  return NextResponse.json(
    {
      success: true,
      level: rates.level,
      maker: rates.maker,
      taker: rates.taker,
      makerBps: rates.maker * 10000,
      takerBps: rates.taker * 10000,
    },
    { headers: NO_STORE },
  );
}
