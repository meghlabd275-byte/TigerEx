import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { assessSwapRisk, submitPrivateOrder, revealBatch, scanRecentSandwiches } from '@/lib/dex/mev-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap MEV protection.
 *
 * `GET` scores a pending swap against the venue's real pools, or returns the
 * recent sandwich scan. `POST` submits a swap to the private order path, which
 * stores a commitment rather than the plaintext so a searcher reading the
 * pending set learns nothing. `PUT` reveals a batch so its orders can settle.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  try {
    if (params.get('scan') === 'sandwich') {
      return NextResponse.json({ success: true, scan: scanRecentSandwiches() }, { headers: NO_STORE });
    }
    const assessment = assessSwapRisk({
      tokenIn: params.get('tokenIn') ?? '',
      tokenOut: params.get('tokenOut') ?? '',
      amountIn: Number(params.get('amountIn')),
      slippage: params.get('slippage') ?? undefined,
    });
    return NextResponse.json({ success: true, assessment }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.mev.submit', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const order = submitPrivateOrder({
      userId: auth.user.userId,
      tokenIn: String(body.tokenIn ?? ''),
      tokenOut: String(body.tokenOut ?? ''),
      amountIn: Number(body.amountIn),
      windowSeconds: body.windowSeconds === undefined ? undefined : Number(body.windowSeconds),
    });
    return NextResponse.json({ success: true, order }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.mev.reveal', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const batchId = String(body?.batchId ?? request.nextUrl.searchParams.get('batchId') ?? '');
  try {
    if (!batchId) return fail('INVALID_BATCH', 'batchId is required');
    return NextResponse.json({ success: true, batch: revealBatch(batchId) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
