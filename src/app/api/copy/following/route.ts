import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listFollowing } from '@/lib/trading/copy-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The leaders the caller follows.
 *
 * Each entry is the caller's own `copy_follows` row joined to the leader's
 * profile, so the copy mode, caps and take-profit/stop-loss are the values the
 * mirroring path will use.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const following = listFollowing(auth.user.userId);
  return NextResponse.json({ success: true, following, data: following }, { headers: NO_STORE });
}
