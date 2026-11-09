import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { executeQuote, OtcError } from '@/lib/otc/quote';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Execute an OTC block quote.
 *
 * The block settles against the venue's own desk inventory at the quoted price,
 * so it moves no book price. A desk that does not hold the asset it would
 * deliver refuses the fill rather than conjuring inventory.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'otc.execute', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  const quoteId = String(body.quoteId ?? body.quote_id ?? '').trim();
  if (!quoteId) return fail('VALIDATION_FAILED', 'quoteId is required');

  try {
    const fill = executeQuote(auth.user.userId, quoteId);
    return NextResponse.json({ success: true, fill }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof OtcError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
