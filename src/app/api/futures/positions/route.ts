import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listPositions } from '@/lib/trading/futures-engine';
import { toPositionPayload } from '@/lib/trading/position-view';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's open derivative positions.
 *
 * Reads the exchange's own `futures_positions` table. An account with no open
 * position receives an empty list, never a placeholder position.
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
