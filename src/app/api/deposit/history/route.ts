import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userDeposits } from '@/lib/wallet/withdrawals';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's deposit history.
 *
 * Read from the exchange's own `deposits` table; an account that has never
 * deposited gets an empty list rather than a fabricated credit.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const asset = request.nextUrl.searchParams.get('coin') ?? request.nextUrl.searchParams.get('asset');
  const status = request.nextUrl.searchParams.get('status');
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);

  const deposits = userDeposits(auth.user.userId, {
    asset: asset ?? undefined,
    status: status ?? undefined,
    limit: Number.isFinite(limit) ? limit : 100,
  });

  return NextResponse.json({ success: true, deposits, data: deposits }, { headers: NO_STORE });
}
