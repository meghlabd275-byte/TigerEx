import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { scanCopySwaps, mirrorCopySwaps, copyMirrors } from '@/lib/dex/copy-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap copy trading.
 *
 * `GET` lists the leader swaps the caller's config would mirror and the mirrors
 * already settled; `POST` settles the pending mirrors as real swaps from the
 * caller's own balance. Each leader swap is mirrored at most once per follow.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    const userId = auth.user.userId;
    return NextResponse.json(
      { success: true, pending: scanCopySwaps(userId), mirrors: copyMirrors(userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.copy.mirror');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  const limit = body.limit === undefined ? 25 : Number(body.limit);
  if (!Number.isFinite(limit) || limit <= 0) return fail('VALIDATION_FAILED', 'limit must be a positive number');

  try {
    const results = mirrorCopySwaps(auth.user.userId, limit);
    return NextResponse.json(
      {
        success: true,
        mirrored: results.filter((r) => r.status === 'mirrored').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        results,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}
