import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { dailySeries, exchangeStats, revenueByCategory } from '@/lib/db/analytics';
import { fail, NO_STORE } from '@/lib/api/route-guards';

/**
 * Daily volume, user growth and revenue series aggregated from the exchange
 * ledger. Days with no activity are reported as zero rather than omitted.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rawDays = request.nextUrl.searchParams.get('days') ?? '30';
  const days = Number.parseInt(rawDays, 10);
  if (!Number.isFinite(days) || days < 1 || days > 366) {
    return fail('VALIDATION_FAILED', 'days must be an integer between 1 and 366');
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        days,
        summary: exchangeStats(),
        revenue: revenueByCategory(),
        series: dailySeries(days),
      },
    },
    { headers: NO_STORE },
  );
}
