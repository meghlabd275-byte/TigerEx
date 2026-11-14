import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { voteGauge, submitBribe, claimBribe, currentEpoch } from '@/lib/dex/farm-service';
import { dexFailure } from '@/lib/dex/route-helpers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** List gauges with their weights, emission share and the epoch's bribes. */
export async function GET(_request: NextRequest) {
  try {
    const epoch = currentEpoch();
    const gauges = getDb().prepare('SELECT * FROM dex_gauges ORDER BY weight DESC').all() as Array<Record<string, unknown>>;
    const bribes = getDb().prepare('SELECT * FROM dex_bribes WHERE epoch = ? ORDER BY created_at DESC').all(epoch) as Array<Record<string, unknown>>;
    return NextResponse.json({ success: true, epoch, gauges, bribes }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

/** Cast a gauge vote, submit a bribe, or claim a bribe (`action`). */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.gauge', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    const action = String(body.action ?? 'vote').toLowerCase();
    if (action === 'bribe') {
      const bribeId = submitBribe(auth.user.userId, String(body.gaugeId ?? ''), String(body.token ?? ''), Number(body.amount));
      return NextResponse.json({ success: true, bribeId }, { status: 201, headers: NO_STORE });
    }
    if (action === 'claim') {
      const claim = claimBribe(auth.user.userId, String(body.bribeId ?? ''));
      return NextResponse.json({ success: true, claim }, { headers: NO_STORE });
    }
    voteGauge(auth.user.userId, String(body.gaugeId ?? ''), Number(body.weight));
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
