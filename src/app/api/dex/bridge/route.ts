import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { initiateBridge, releaseBridge, bridgeTransfers } from '@/lib/dex/launch-service';
import { dexFailure } from '@/lib/dex/route-helpers';

/** The caller's bridge transfers. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({ success: true, transfers: bridgeTransfers(auth.user.userId) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

/** Initiate a bridge transfer, or release a pending one for the relayer. */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.bridge', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    if (String(body.action ?? 'initiate').toLowerCase() === 'release') {
      releaseBridge(String(body.transferId ?? ''), String(body.releaseTx ?? ''));
      return NextResponse.json({ success: true }, { headers: NO_STORE });
    }
    const transfer = initiateBridge({
      userId: auth.user.userId,
      fromChain: String(body.fromChain ?? ''),
      toChain: String(body.toChain ?? ''),
      asset: String(body.asset ?? ''),
      amount: Number(body.amount),
    });
    return NextResponse.json({ success: true, transfer }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
