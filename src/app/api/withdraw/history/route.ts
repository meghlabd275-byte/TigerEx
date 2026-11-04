import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userWithdrawals } from '@/lib/wallet/withdrawals';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's withdrawal history.
 *
 * Read from the exchange's own `withdrawals` table; an account that has never
 * withdrawn gets an empty list. Both `withdrawals` and `data` carry the rows,
 * because the wallet history view reads the latter.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const asset = request.nextUrl.searchParams.get('coin') ?? request.nextUrl.searchParams.get('asset');
  const status = request.nextUrl.searchParams.get('status');
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);

  const withdrawals = userWithdrawals(auth.user.userId, {
    asset: asset ?? undefined,
    status: status ?? undefined,
    limit: Number.isFinite(limit) ? limit : 100,
  });

  return NextResponse.json({ success: true, withdrawals, data: withdrawals }, { headers: NO_STORE });
}
