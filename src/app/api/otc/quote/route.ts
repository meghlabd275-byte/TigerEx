import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { requestQuote, OtcError } from '@/lib/otc/quote';
import { fail, enforceRequestGuards, symbolParam, NO_STORE } from '@/lib/api/route-guards';

/**
 * Request an OTC block quote.
 *
 * The quote is priced from the venue's own order book for the requested size,
 * so it reflects the liquidity that actually exists. A size the book cannot
 * absorb is still quoted, with the shortfall reported, rather than refused.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'otc.quote', 60, 60_000);
  if (guard) return guard;

  const params = request.nextUrl.searchParams;
  const rawSymbol = params.get('symbol') ?? params.get('asset');
  const symbol = symbolParam(rawSymbol);
  const asset = symbol ? symbol.split('/')[0] : String(rawSymbol ?? '').trim().toUpperCase();
  if (!asset) return fail('VALIDATION_FAILED', 'symbol or asset is required');

  const side = String(params.get('side') ?? 'buy').trim().toLowerCase();
  const amount = Number(params.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) return fail('VALIDATION_FAILED', 'amount must be a positive number');

  try {
    const quote = requestQuote(auth.user.userId, asset, side, amount);
    return NextResponse.json({ success: true, ...quote, data: quote }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof OtcError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
