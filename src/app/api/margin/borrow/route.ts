import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { borrow, MarginError } from '@/lib/trading/margin-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Open a spot margin loan.
 *
 * The collateral is locked and the borrowed asset credited in one transaction,
 * against the LTV and borrowable set of the admin-listed margin market.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'margin.borrow');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const loan = borrow(auth.user.userId, {
      symbol: String(body.symbol ?? body.pair ?? ''),
      mode: body.mode === undefined ? undefined : String(body.mode),
      asset: String(body.asset ?? body.loanAsset ?? ''),
      amount: Number(body.amount),
      collateralAsset: String(body.collateralAsset ?? ''),
      collateralAmount: Number(body.collateralAmount),
    });
    return NextResponse.json({ success: true, loan }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof MarginError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
