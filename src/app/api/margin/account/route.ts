import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { marginAccount } from '@/lib/trading/margin-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's margin account.
 *
 * Collateral and debt are valued at the venue's own prices; an account with no
 * loans reports zeros rather than a fabricated balance.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const account = marginAccount(auth.user.userId);
  return NextResponse.json({ success: true, ...account }, { headers: NO_STORE });
}
