import { NextResponse } from 'next/server';
import { readiness } from '@/lib/ops/health';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Readiness probe.
 *
 * Answers 200 only when every required dependency is reachable, so an
 * orchestrator holds traffic back from an instance whose database is down.
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
