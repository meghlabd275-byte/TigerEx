import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { scanSnipeCandidates, quoteSnipe, executeSnipe } from '@/lib/dex/sniping-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap sniping bot.
 *
 * `GET` lists the venue's own pools that are eligible to be sniped, best first,
 * and prices a snipe of one token into another. `POST` executes a snipe through
 * the normal swap path. The candidate set is TigerSwap's own pools; there is no
 * third-party launch feed.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const tokenIn = params.get('tokenIn') ?? '';
  try {
    if (params.get('poolId')) {
      const quote = quoteSnipe({
        poolId: params.get('poolId') ?? '',
        tokenIn,
        tokenOut: params.get('tokenOut') ?? '',
        amountIn: Number(params.get('amountIn')),
        slippage: params.get('slippage') ?? undefined,
      });
      return NextResponse.json({ success: true, quote }, { headers: NO_STORE });
    }
    return NextResponse.json({ success: true, scan: scanSnipeCandidates(tokenIn) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.snipe', 20, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const execution = executeSnipe({
      userId: auth.user.userId,
      poolId: String(body.poolId ?? ''),
      tokenIn: String(body.tokenIn ?? ''),
      tokenOut: String(body.tokenOut ?? ''),
      amountIn: Number(body.amountIn),
      slippage: body.slippage as number | undefined,
    });
    return NextResponse.json({ success: true, snipe: execution }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
