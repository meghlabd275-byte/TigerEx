import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { leaderProfile, listFollowing, applyAsLeader, CopyError } from '@/lib/trading/copy-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's copy-trading identity.
 *
 * GET returns both sides of the relationship: the leader profile this account
 * has (if any) and the leaders it follows. POST applies to become a leader; the
 * application is created pending operator approval.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const leader = leaderProfile(auth.user.userId);
  const following = listFollowing(auth.user.userId);

  return NextResponse.json(
    { success: true, isLeader: leader !== null, leader, following, data: { leader, following } },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'copy.apply', 10, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const displayName = String(body.displayName ?? body.name ?? '').trim();
  const markets = Array.isArray(body.markets) ? body.markets.map(String) : [];

  try {
    const leader = applyAsLeader(auth.user.userId, { displayName, markets });
    return NextResponse.json({ success: true, leader, data: leader }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof CopyError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
