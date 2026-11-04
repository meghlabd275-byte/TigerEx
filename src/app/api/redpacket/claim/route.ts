import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { claimRedPacket, RewardsError } from '@/lib/earn/rewards';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Claim a share of a red packet.
 *
 * One claim per account per packet is enforced by a unique key, and the share
 * is paid from the creator's escrow, so a packet can never pay out more than it
 * was funded with.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'redpacket.claim', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const packetId = String(body?.packetId ?? body?.code ?? request.nextUrl.searchParams.get('packetId') ?? '').trim();
  if (!packetId) return fail('VALIDATION_FAILED', 'A red packet id is required');

  try {
    const result = claimRedPacket(auth.user.userId, packetId);
    return NextResponse.json({ success: true, amount: result.amount, data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RewardsError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    console.error('Red packet claim error:', error);
    return fail('INTERNAL_ERROR', 'The red packet could not be claimed', 500);
  }
}
