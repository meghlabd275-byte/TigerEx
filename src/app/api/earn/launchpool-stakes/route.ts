import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userStakes } from '@/lib/earn/launchpool';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's launchpool stakes.
 *
 * Scoped to the authenticated account; the `userId` query parameter is accepted
 * for compatibility but ignored, so a request cannot read another account's
 * stakes.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const stakes = userStakes(auth.user.userId);
  return NextResponse.json({ success: true, data: stakes, stakes }, { headers: NO_STORE });
}
