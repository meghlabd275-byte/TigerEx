import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { marginAccount } from '@/lib/trading/margin-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/** Alias of `/api/margin/account` kept for the views that call the plural path. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const account = marginAccount(auth.user.userId);
  return NextResponse.json(
    { success: true, accounts: [account], ...account },
    { headers: NO_STORE },
  );
}
