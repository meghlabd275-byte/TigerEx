import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fail, symbolParam, NO_STORE } from '@/lib/api/route-guards';
import { markPriceForContract } from '@/lib/trading/mark-price';
import { fundingRate as premiumRate } from '@/lib/oracle/aggregator';

const HOUR_NS = 60 * 60 * 1e9;

/**
 * Funding rate history for a perpetual contract.
 *
 * Reads the exchange's own `funding_rates` table, newest first. A contract with
 * no settled funding interval returns an empty history and a null current rate
 * rather than a made-up rate.
 *
 * `nextFundingTimeNs` is derived from the contract's own funding interval and
 * the last settled interval; `predictedFundingRate` is the live premium the
 * next settlement would charge, computed from the venue's own mark and index.
 * Both are null when the contract is not a perpetual or its price cannot be
 * published, rather than guessed.
 */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) return fail('VALIDATION_FAILED', 'A symbol such as BTC/RUSD is required');

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 100) || 100, 1), 1000);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT funding_id, symbol, funding_rate, mark_price, index_price, premium, funding_time_ns, created_at
         FROM funding_rates WHERE symbol = ? ORDER BY funding_time_ns DESC LIMIT ?`,
    )
    .all(symbol, limit) as Array<Record<string, unknown>>;

  const latest = rows[0] ?? null;

  const market = db
    .prepare(
      `SELECT funding_interval_hours, funding_rate_cap, status, listing_type
         FROM futures_markets WHERE symbol = ?`,
    )
    .get(symbol) as
    | { funding_interval_hours: number; funding_rate_cap: number; status: string; listing_type: string }
    | undefined;

  let nextFundingTimeNs: number | null = null;
  let predictedFundingRate: number | null = null;
  if (market && market.listing_type === 'perpetual') {
    const intervalNs = Math.max(1, Number(market.funding_interval_hours) || 8) * HOUR_NS;
    const lastNs = latest ? Number(latest.funding_time_ns) : 0;
    nextFundingTimeNs = lastNs > 0 ? lastNs + intervalNs : Date.now() * 1e6;

    const price = markPriceForContract(symbol);
    if (price) {
      const predicted = premiumRate(price.mark, price.index, 0, Number(market.funding_rate_cap) || 0.01);
      if (typeof predicted === 'number') predictedFundingRate = predicted;
    }
  }

  return NextResponse.json(
    {
      success: true,
      symbol,
      fundingRate: latest ? latest.funding_rate : null,
      markPrice: latest ? latest.mark_price : null,
      indexPrice: latest ? latest.index_price : null,
      nextFundingTimeNs,
      predictedFundingRate,
      history: rows.map((row) => ({
        fundingId: row.funding_id,
        fundingRate: row.funding_rate,
        markPrice: row.mark_price,
        indexPrice: row.index_price,
        premium: row.premium,
        fundingTimeNs: row.funding_time_ns,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}
