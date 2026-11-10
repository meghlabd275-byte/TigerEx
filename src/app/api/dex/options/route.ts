import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { listOptionPools, buyOption, settleOption, optionPositions } from '@/lib/dex/options-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap options AMM.
 *
 * `GET` lists the pools and the caller's positions; `POST` buys a call or put;
 * `DELETE` settles an open position at the current spot. The pool is the
 * counterparty and reserves each contract's worst-case payout, so a buy that
 * the pool cannot back is refused.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(
      { success: true, pools: listOptionPools(), positions: optionPositions(auth.user.userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.option.buy', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const result = buyOption({
      userId: auth.user.userId,
      poolId: String(body.poolId ?? ''),
      type: String(body.type ?? '').toLowerCase() as 'call' | 'put',
      strike: Number(body.strike),
      capPrice: body.capPrice === undefined ? undefined : Number(body.capPrice),
      quantity: Number(body.quantity),
      expiry: body.expiry ? String(body.expiry) : undefined,
    });
    return NextResponse.json({ success: true, option: result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.option.settle', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const params = request.nextUrl.searchParams;
  const positionId = String(body?.positionId ?? params.get('positionId') ?? '');
  if (!positionId) return fail('VALIDATION_FAILED', 'positionId is required');

  try {
    const result = settleOption(auth.user.userId, positionId);
    return NextResponse.json({ success: true, settlement: result }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
