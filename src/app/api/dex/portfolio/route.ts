import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { getDb } from '@/lib/db';
import { dexFailure } from '@/lib/dex/route-helpers';
import { NO_STORE } from '@/lib/api/route-guards';
import { priceInQuote } from '@/lib/trading/valuation';

export const dynamic = 'force-dynamic';

/**
 * The caller's TigerSwap portfolio.
 *
 * Balances come from the ledger and are valued with the venue's own prices; a
 * holding with no price is returned with a null value rather than an invented
 * one, so the total is never overstated.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    const balances = getDb()
      .prepare(
        `SELECT b.currency, SUM(b.available) AS available, SUM(b.locked) AS locked
           FROM balances b JOIN wallets w ON w.wallet_id = b.wallet_id
          WHERE w.user_id = ?
          GROUP BY b.currency`,
      )
      .all(auth.user.userId) as Array<{ currency: string; available: number; locked: number }>;

    let totalUsd = 0;
    let priced = true;
    const holdings = balances.map((row) => {
      const price = priceInQuote(row.currency, 'RUSD');
      const value = price === null ? null : price * (Number(row.available) + Number(row.locked));
      if (value === null) priced = false;
      else totalUsd += value;
      return {
        currency: row.currency,
        available: Number(row.available),
        locked: Number(row.locked),
        priceUsd: price,
        valueUsd: value,
      };
    });

    return NextResponse.json({ success: true, holdings, totalUsd, fullyPriced: priced }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
