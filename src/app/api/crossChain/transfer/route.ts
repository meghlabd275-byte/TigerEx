import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { initiateTransfer, transferStatus, transferHistory, BridgeError } from '@/lib/wallet/bridge';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Cross-chain bridge transfers.
 *
 * A transfer debits the caller's balance on the source side and records the
 * destination chain and a validated destination address. GET without a
 * `transferId` returns the caller's own bridge history.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'bridge.transfer', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const transfer = initiateTransfer({
      userId: auth.user.userId,
      fromChain: String(body.fromChain ?? ''),
      toChain: String(body.toChain ?? ''),
      asset: String(body.token ?? body.asset ?? ''),
      amount: Number(body.amount),
      toAddress: String(body.toAddress ?? ''),
    });
    return NextResponse.json({ success: true, transfer, data: transfer }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof BridgeError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

/** One transfer's status, or the caller's whole bridge history. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const transferId = request.nextUrl.searchParams.get('transferId')?.trim();
  if (transferId) {
    const transfer = transferStatus(auth.user.userId, transferId);
    if (!transfer) return fail('UNKNOWN_TRANSFER', 'No such transfer for this account', 404);
    return NextResponse.json({ success: true, transfer, data: transfer }, { headers: NO_STORE });
  }

  const transfers = transferHistory(auth.user.userId);
  return NextResponse.json({ success: true, transfers, data: transfers }, { headers: NO_STORE });
}
