import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { createRedPacket, RewardsError } from '@/lib/earn/rewards';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Create a red packet.
 *
 * The full amount is escrowed from the creator immediately, so every packet a
 * claimer can find is backed by funds the exchange already holds.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'redpacket.create', 20, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const packet = createRedPacket({
      userId: auth.user.userId,
      asset: String(body.asset ?? body.coin ?? ''),
      amount: Number(body.amount),
      quantity: Number(body.quantity ?? body.count),
      type: String(body.type ?? 'random').toLowerCase() === 'average' ? 'average' : 'random',
      message: body.message === undefined || body.message === null ? null : String(body.message),
      expiresAt: body.expiresAt === undefined || body.expiresAt === null ? null : String(body.expiresAt),
    });
    return NextResponse.json({ success: true, packet, data: packet }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RewardsError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    console.error('Red packet error:', error);
    return fail('INTERNAL_ERROR', 'The red packet could not be created', 500);
  }
}
