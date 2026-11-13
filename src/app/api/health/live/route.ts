import { NextResponse } from 'next/server';
import { liveness } from '@/lib/ops/health';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Liveness probe.
 *
 * Answers 200 whenever the process can respond, so a scheduler restarts the
 * container only when it is genuinely wedged rather than when a downstream
 * dependency is briefly unavailable.
 */
export const dynamic = 'force-dynamic';

const STARTED_AT = Date.now();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(liveness(STARTED_AT), { status: 200, headers: NO_STORE });
}
