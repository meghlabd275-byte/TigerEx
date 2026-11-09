import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { addLiquidity, removeLiquidity, userPositions } from '@/lib/dex/liquidity-service';
import { dexFailure } from '@/lib/dex/route-helpers';

/**
 * TigerSwap liquidity provision.
 *
 * `GET` lists the caller's positions; `POST` adds liquidity; `DELETE` removes
 * it. Every movement is a real ledger transfer inside one transaction.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({ success: true, positions: userPositions(auth.user.userId) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.liquidity.add', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const result = addLiquidity({
      userId: auth.user.userId,
      poolId: String(body.poolId ?? ''),
      amounts: (body.amounts ?? {}) as Record<string, number>,
      tickLower: body.tickLower === undefined ? undefined : Number(body.tickLower),
      tickUpper: body.tickUpper === undefined ? undefined : Number(body.tickUpper),
      lockedUntil: body.lockedUntil ? String(body.lockedUntil) : undefined,
    });
    return NextResponse.json({ success: true, position: result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.liquidity.remove', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const poolId = String(body?.poolId ?? request.nextUrl.searchParams.get('poolId') ?? '');
  const liquidity = Number(body?.liquidity ?? request.nextUrl.searchParams.get('liquidity'));

  try {
    const result = removeLiquidity({ userId: auth.user.userId, poolId, liquidity });
    return NextResponse.json({ success: true, removed: result }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
