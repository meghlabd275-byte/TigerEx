import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runSettlementCycle } from '@/lib/trading/settlement';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Run one settlement cycle: charge due perpetual funding, settle expired
 * option contracts, and rebalance leveraged tokens whose NAV has drifted.
 *
 * These are the time-driven venue actions that must happen on a schedule. The
 * endpoint is guarded by a shared secret rather than a trader session because a
 * scheduler, not a person, calls it. Without `TIGEREX_KEEPER_SECRET` configured
 * it fails closed, so an unconfigured deployment never exposes an
 * unauthenticated way to move funds.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.TIGEREX_KEEPER_SECRET;
  if (!secret || secret.length < 16) return false;
  const presented = request.headers.get('x-keeper-secret') ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Keeper secret required' } },
      { status: 401, headers: NO_STORE },
    );
  }
  try {
    return NextResponse.json({ success: true, report: runSettlementCycle() }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Settlement cycle failed';
    return NextResponse.json(
      { success: false, error: { code: 'SETTLEMENT_FAILED', message } },
      { status: 500, headers: NO_STORE },
    );
  }
}
