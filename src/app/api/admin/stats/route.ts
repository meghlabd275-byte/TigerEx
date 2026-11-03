import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { exchangeStats } from '@/lib/db/analytics';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Exchange-wide counters computed from the durable ledger.
 *
 * Served from the exchange's own database rather than proxied to a backend, so
 * a self-contained deployment reports its real figures with no external
 * dependency.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json({ success: true, data: exchangeStats() }, { headers: NO_STORE });
}
