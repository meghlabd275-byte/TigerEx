import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { closePosition, FuturesError } from '@/lib/trading/futures-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Close a futures position.
 *
 * The position is closed at the venue's current mark price, releasing its
 * margin and settling the realized P&L and fee in the ledger. Closing an
 * already-closed or unknown position is refused rather than reported as done.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'futures.position.close');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const positionId = String(body.positionId ?? body.position_id ?? '').trim();
  if (!positionId) return fail('VALIDATION_FAILED', 'positionId is required');

  try {
    const result = closePosition(auth.user.userId, positionId);
    return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof FuturesError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
