import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listPositions } from '@/lib/options/options-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/** The caller's full options position history, including closed and settled. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const positions = listPositions(auth.user.userId, { status: 'closed' })
    .concat(listPositions(auth.user.userId, { status: 'settled' }));
  return NextResponse.json({ success: true, positions, data: positions }, { headers: NO_STORE });
}
