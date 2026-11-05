import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { vipInfo } from '@/lib/trading/vip';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's VIP tier.
 *
 * Resolved from real 30-day volume and the live TGR balance, so it matches the
 * rate the fee engine will charge on the next trade.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const info = vipInfo(auth.user.userId);
  return NextResponse.json({ success: true, data: info, vip: info }, { headers: NO_STORE });
}
