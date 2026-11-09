import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { lockVetgr, unlockVetgr, vetgrStatus } from '@/lib/dex/farm-service';
import { dexFailure } from '@/lib/dex/route-helpers';

/** The caller's veTGR lock and voting power. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({ success: true, lock: vetgrStatus(auth.user.userId) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

/** Create or extend a veTGR lock. */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.vetgr.lock', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    const lock = lockVetgr(auth.user.userId, Number(body.amount), Number(body.lockDays));
    return NextResponse.json({ success: true, lock }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

/** Release a matured veTGR lock. */
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.vetgr.unlock', 30, 60_000);
  if (guard) return guard;
  try {
    const released = unlockVetgr(auth.user.userId);
    return NextResponse.json({ success: true, released }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
