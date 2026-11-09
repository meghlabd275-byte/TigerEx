import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { refundRedPacket, RewardsError } from '@/lib/earn/rewards';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Refund the unclaimed balance of an expired red packet to its creator.
 *
 * A packet escrows the whole amount up front; whatever no one claimed would
 * otherwise stay locked forever, so the creator can reclaim it once the packet
 * has expired. Only the creator may refund, and only an active, expired packet,
 * so the escrow is released exactly once.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'redpacket.refund', 20, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const packetId = String(body?.packetId ?? request.nextUrl.searchParams.get('packetId') ?? '').trim();
  if (!packetId) return fail('VALIDATION_FAILED', 'A red packet id is required');

  try {
    const result = refundRedPacket(auth.user.userId, packetId);
    return NextResponse.json({ success: true, refunded: result.refunded, data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RewardsError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    console.error('Red packet refund error:', error);
    return fail('INTERNAL_ERROR', 'The red packet could not be refunded', 500);
  }
}
