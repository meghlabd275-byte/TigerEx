import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { repay, MarginError } from '@/lib/trading/margin-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Repay a spot margin loan.
 *
 * Interest is settled before principal and the collateral backing the repaid
 * principal is released, so a partial repayment frees only what it earned.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'margin.repay');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const loanId = String(body.loanId ?? '').trim();
  if (!loanId) return fail('VALIDATION_FAILED', 'loanId is required');

  try {
    const loan = repay(auth.user.userId, loanId, Number(body.amount));
    return NextResponse.json({ success: true, loan }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MarginError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
