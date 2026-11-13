import { NextResponse } from 'next/server';
import { readiness } from '@/lib/ops/health';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Aggregate health probe.
 *
 * Returns 200 when the instance is ready to serve trading traffic and 503 when
 * it is not, so a load balancer or orchestrator can act on the status code
 * without parsing the body. The body always carries the per-dependency detail.
 */
export const dynamic = 'force-dynamic';

const STARTED_AT = Date.now();

export async function GET(): Promise<NextResponse> {
  const report = readiness(STARTED_AT);
  return NextResponse.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: NO_STORE,
  });
}
