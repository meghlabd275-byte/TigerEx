import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { spotRates, futuresRates } from '@/lib/trading/spot-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's effective trading fee rates.
 *
 * Resolved by the fee engine from the same schedule it charges from, using the
 * account's real 30-day volume and TGR balance, so the quoted rate is the rate
 * the next trade will pay.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const symbol = request.nextUrl.searchParams.get('symbol')?.trim().toUpperCase() ?? null;
  const market = symbol && !symbol.includes('/') && !/^(FUTURES|SPOT)$/.test(symbol) ? 'futures' : null;

  const spot = spotRates(auth.user.userId);
  const futures = futuresRates(auth.user.userId);
  const selected = market === 'futures' ? futures : spot;

  return NextResponse.json(
    {
      success: true,
      symbol,
      level: selected.level,
      maker: selected.maker,
      taker: selected.taker,
      makerFee: selected.maker,
      takerFee: selected.taker,
      spot,
      futures,
    },
    { headers: NO_STORE },
  );
}
