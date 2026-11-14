import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { stakeFarm, unstakeFarm, claimFarm, farmPositions } from '@/lib/dex/farm-service';
import { dexFailure } from '@/lib/dex/route-helpers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap farms.
 *
 * `GET` lists the active farms and, for an authenticated caller, their stakes.
 * `POST` stakes or unstakes, and `PUT` claims pending rewards. The stake is a
 * real ledger reservation and the reward accounting is settled on every change.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    const farms = getDb()
      .prepare("SELECT farm_id, name, pool_id, reward_token, reward_rate, apr, total_staked, boost_multiplier, status FROM dex_farms ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    return NextResponse.json(
      { success: true, farms, positions: farmPositions(auth.user.userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.farm.stake', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const farmId = String(body.farmId ?? '');
  const amount = Number(body.amount);
  const action = String(body.action ?? 'stake').toLowerCase();
  try {
    if (action === 'unstake') {
      return NextResponse.json({ success: true, stake: unstakeFarm(auth.user.userId, farmId, amount) }, { headers: NO_STORE });
    }
    return NextResponse.json({ success: true, stake: stakeFarm(auth.user.userId, farmId, amount) }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.farm.claim', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    const claimed = claimFarm(auth.user.userId, String(body.farmId ?? ''));
    return NextResponse.json({ success: true, claimed }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
