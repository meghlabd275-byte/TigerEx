import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listPositions } from '@/lib/trading/futures-engine';
import { toPositionPayload } from '@/lib/trading/position-view';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Open derivative positions for the caller.
 *
 * Reads the venue's own `futures_positions`; an account with no position gets
 * an empty list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const symbol = request.nextUrl.searchParams.get('symbol');
  const positions = listPositions(auth.user.userId, symbol).map((row) =>
    toPositionPayload(row as unknown as Record<string, unknown>),
  );

  return NextResponse.json({ success: true, positions }, { headers: NO_STORE });
}
