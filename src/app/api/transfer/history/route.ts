import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { transferHistory } from '@/lib/wallet/transfers';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's internal transfer history.
 *
 * Read from the exchange's own transaction log; an account that has never
 * transferred gets an empty list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const transfers = transferHistory(auth.user.userId, Number.isFinite(limit) ? limit : 50);

  return NextResponse.json({ success: true, transfers, data: transfers }, { headers: NO_STORE });
}
