import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { quoteSwap, executeSwap } from '@/lib/dex/swap-service';
import { dexFailure } from '@/lib/dex/route-helpers';

/**
 * TigerSwap swap endpoint.
 *
 * `GET` quotes a trade without moving funds; `POST` executes it, debiting the
 * input and crediting the output in one ledger transaction. Both take the route
 * from the venue's own aggregator over its own pools.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  try {
    const quote = quoteSwap({
      tokenIn: params.get('tokenIn') ?? '',
      tokenOut: params.get('tokenOut') ?? '',
      amountIn: Number(params.get('amountIn')),
      slippage: params.get('slippage') ?? undefined,
    });
    return NextResponse.json({ success: true, quote }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.swap', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const result = executeSwap({
      userId: auth.user.userId,
      tokenIn: String(body.tokenIn ?? ''),
      tokenOut: String(body.tokenOut ?? ''),
      amountIn: Number(body.amountIn),
      slippage: body.slippage as number | undefined,
      gasless: Boolean(body.gasless),
      clientId: body.clientId ? String(body.clientId) : undefined,
    });
    return NextResponse.json({ success: true, swap: result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
