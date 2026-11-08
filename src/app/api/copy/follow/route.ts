import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { followLeader, updateFollow, unfollow, CopyError } from '@/lib/trading/copy-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Following a copy-trading leader.
 *
 * POST starts a follow; PUT changes its configuration or pauses it; DELETE
 * stops it and releases the follower slot. The leader must be approved and not
 * already full, and the copy config is validated by the same planner the
 * mirroring path runs with.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'copy.follow', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const traderId = String(body.traderId ?? body.id ?? '').trim();
  const mode = String(body.mode ?? 'ratio').trim().toLowerCase();
  // A client may send `amount` as the fixed notional or `ratio` as the fraction.
  const fixedAmount = body.fixedAmount ?? (mode === 'fixed' ? body.amount : undefined);

  try {
    const follow = followLeader(auth.user.userId, {
      traderId,
      mode,
      fixedAmount,
      ratio: body.ratio ?? (mode === 'ratio' ? body.amount : undefined),
      maxPosition: body.maxPosition,
      takeProfit: body.takeProfit,
      stopLoss: body.stopLoss,
    });
    return NextResponse.json({ success: true, follow, data: follow }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof CopyError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'copy.follow.update', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const followId = String(body.followId ?? body.id ?? '').trim();
  if (!followId) return fail('VALIDATION_FAILED', 'A followId is required');

  try {
    const follow = updateFollow(auth.user.userId, followId, {
      mode: body.mode === undefined ? undefined : String(body.mode),
      fixedAmount: body.fixedAmount ?? body.amount,
      ratio: body.ratio,
      maxPosition: body.maxPosition,
      status: body.status === undefined ? undefined : String(body.status),
    });
    return NextResponse.json({ success: true, follow, data: follow }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CopyError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'copy.follow.stop', 60, 60_000);
  if (guard) return guard;

  const followId = (request.nextUrl.searchParams.get('followId') ?? request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!followId) return fail('VALIDATION_FAILED', 'A followId is required');

  try {
    unfollow(auth.user.userId, followId);
    return NextResponse.json({ success: true, followId }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CopyError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
