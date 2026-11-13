import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runScheduledCycle } from '@/lib/ops/scheduler';
import { fail, NO_STORE } from '@/lib/api/route-guards';

/**
 * External scheduler entry point.
 *
 * A deployment that runs the maintenance cycle from a Kubernetes CronJob (or any
 * external timer) calls this instead of the in-process timer, so the cycle runs
 * exactly once. The endpoint is authenticated with a shared secret compared in
 * constant time, and fails closed when the secret is not configured, so it can
 * never be triggered by an anonymous caller.
 */
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const expected = process.env.TIGEREX_WORKER_TOKEN;
  if (!expected || expected.length < 16) return false;

  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!process.env.TIGEREX_WORKER_TOKEN) {
    return fail('WORKER_NOT_CONFIGURED', 'The worker token is not configured', 503);
  }
  if (!authorized(request)) {
    return fail('UNAUTHORIZED', 'A valid worker token is required', 401);
  }

  const report = await runScheduledCycle();
  return NextResponse.json({ success: true, ...report }, { headers: NO_STORE });
}
