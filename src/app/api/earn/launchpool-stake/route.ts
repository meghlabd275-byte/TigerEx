import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { stakeInCampaign, releaseStake, LaunchpoolError } from '@/lib/earn/launchpool';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Stake into, or release a stake from, a launchpool campaign.
 *
 * A stake locks the caller's tokens in the balance ledger inside one database
 * transaction, so the commitment and the locked balance cannot disagree.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'earn.launchpool.stake');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const stake = stakeInCampaign(auth.user.userId, String(body.project_id ?? body.projectId ?? ''), Number(body.amount));
    return NextResponse.json({ success: true, data: stake, stake }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof LaunchpoolError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

/** Release a stake's locked balance once the campaign has ended. */
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'earn.launchpool.release');
  if (guard) return guard;

  const body = await readJson(request);
  const subscriptionId = String(body?.subscriptionId ?? body?.id ?? request.nextUrl.searchParams.get('subscriptionId') ?? '');
  try {
    releaseStake(auth.user.userId, subscriptionId);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof LaunchpoolError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
