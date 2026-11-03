import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listMarginLoans } from '@/lib/trading/margin-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/** The caller's margin loans with accrued interest and health. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const loans = listMarginLoans(auth.user.userId);
  return NextResponse.json({ success: true, loans }, { headers: NO_STORE });
}
