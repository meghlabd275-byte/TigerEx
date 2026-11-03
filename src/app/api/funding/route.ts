import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fail, symbolParam, NO_STORE } from '@/lib/api/route-guards';

/**
 * Funding rate history for a perpetual contract.
 *
 * Reads the exchange's own `funding_rates` table, newest first. A contract with
 * no settled funding interval returns an empty history and a null current rate
 * rather than a made-up rate.
 */
export async function GET(request: NextRequest) {
  const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
  if (!symbol) return fail('VALIDATION_FAILED', 'A symbol such as BTC/RUSD is required');

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 100) || 100, 1), 1000);

  const rows = getDb()
    .prepare(
      `SELECT funding_id, symbol, funding_rate, mark_price, index_price, premium, funding_time_ns, created_at
         FROM funding_rates WHERE symbol = ? ORDER BY funding_time_ns DESC LIMIT ?`,
    )
    .all(symbol, limit) as Array<Record<string, unknown>>;

  const latest = rows[0] ?? null;

  return NextResponse.json(
    {
      success: true,
      symbol,
      fundingRate: latest ? latest.funding_rate : null,
      markPrice: latest ? latest.mark_price : null,
      indexPrice: latest ? latest.index_price : null,
      nextFundingTimeNs: null,
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
