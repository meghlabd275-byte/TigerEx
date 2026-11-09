import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import {
  listLiquidStaking,
  stakeLiquid,
  unstakeLiquid,
  liquidStakePositions,
} from '@/lib/dex/liquid-staking-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap liquid staking (stTGR).
 *
 * `GET` lists the staking pools and the caller's stTGR positions; `POST` stakes;
 * `DELETE` unstakes. The exchange rate is derived from the pool's real balances
 * on every read, so it can never drift from the ledger.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(
      { success: true, pools: listLiquidStaking(), positions: liquidStakePositions(auth.user.userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.liquid.stake', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const result = stakeLiquid(String(body.stakeId ?? ''), auth.user.userId, Number(body.amount));
    return NextResponse.json({ success: true, stake: result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.liquid.unstake', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const params = request.nextUrl.searchParams;
  try {
    const result = unstakeLiquid(
      String(body?.stakeId ?? params.get('stakeId') ?? ''),
      auth.user.userId,
      Number(body?.shares ?? params.get('shares')),
    );
    return NextResponse.json({ success: true, unstake: result }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
