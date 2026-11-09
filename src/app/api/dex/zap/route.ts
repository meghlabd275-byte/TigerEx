import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { zapIn, zapOut } from '@/lib/dex/zap-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap single-asset zap.
 *
 * `POST` zaps a single token into a two-token pool; `DELETE` redeems an LP
 * position back into a single token. Both move real funds: the swap leg settles
 * through the router and the liquidity leg through the pool.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.zap.in', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const result = zapIn({
      userId: auth.user.userId,
      poolId: String(body.poolId ?? ''),
      tokenIn: String(body.tokenIn ?? ''),
      amountIn: Number(body.amountIn),
      slippage: body.slippage as number | string | undefined,
      lockedUntil: body.lockedUntil ? String(body.lockedUntil) : undefined,
    });
    return NextResponse.json({ success: true, zap: result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.zap.out', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const params = request.nextUrl.searchParams;
  try {
    const result = zapOut({
      userId: auth.user.userId,
      poolId: String(body?.poolId ?? params.get('poolId') ?? ''),
      liquidity: Number(body?.liquidity ?? params.get('liquidity')),
      tokenOut: String(body?.tokenOut ?? params.get('tokenOut') ?? ''),
      slippage: (body?.slippage ?? params.get('slippage')) as number | string | undefined,
    });
    return NextResponse.json({ success: true, zap: result }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
