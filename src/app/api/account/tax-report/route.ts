import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { fail, NO_STORE } from '@/lib/api/route-guards';
import { buildTaxReport, parsePeriod, taxReportToCsv, StatementError } from '@/lib/account/statements';

/**
 * Tax report.
 *
 * Returns realised P&L (average-cost method) and fees per asset over a period,
 * as JSON or as a CSV download (`?format=csv`). Built from the user's own
 * `spot_trades` fills — nothing is estimated.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  let period;
  try {
    period = parsePeriod(searchParams.get('from'), searchParams.get('to'));
  } catch (error) {
    if (error instanceof StatementError) return fail(error.code, error.message, error.status);
    throw error;
  }

  const report = buildTaxReport(auth.user.userId, period);

  if ((searchParams.get('format') ?? '').toLowerCase() === 'csv') {
    return new NextResponse(taxReportToCsv(report), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tax-report-${period.from.slice(0, 10)}-to-${period.to.slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ success: true, report }, { headers: NO_STORE });
}
