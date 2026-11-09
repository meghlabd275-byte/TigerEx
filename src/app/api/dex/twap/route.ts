import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { getDb, generateId } from '@/lib/db';
import { dexFailure } from '@/lib/dex/route-helpers';
import { loadPool } from '@/lib/dex/pool-service';

/**
 * Time-weighted average price plans.
 *
 * A TWAP plan splits one large order into equal slices released at a fixed
 * interval; the keeper executes each slice through the swap service, so the
 * order is worked over time rather than dumped into the pool at once.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    const plans = getDb()
      .prepare('SELECT * FROM dex_twap_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
      .all(auth.user.userId) as Array<Record<string, unknown>>;
    return NextResponse.json({ success: true, plans }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.twap.create', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    const pool = loadPool(String(body.poolId ?? ''));
    const totalAmountIn = Number(body.totalAmountIn);
    const slices = Number(body.slices);
    const intervalMs = Number(body.intervalMs);
    if (!Number.isFinite(totalAmountIn) || totalAmountIn <= 0) return fail('INVALID_AMOUNT', 'totalAmountIn must be positive');
    if (!Number.isInteger(slices) || slices <= 0 || slices > 10_000) return fail('INVALID_SLICES', 'slices must be a positive integer');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return fail('INVALID_INTERVAL', 'intervalMs must be positive');

    const planId = generateId();
    getDb()
      .prepare(
        `INSERT INTO dex_twap_plans (plan_id, pool_id, user_id, token_in, token_out, total_amount_in, slices, interval_ms, start_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        planId,
        pool.pool_id,
        auth.user.userId,
        String(body.tokenIn ?? '').toUpperCase(),
        String(body.tokenOut ?? '').toUpperCase(),
        totalAmountIn,
        slices,
        intervalMs,
        body.startAt ? new Date(String(body.startAt)).toISOString() : new Date().toISOString(),
      );
    return NextResponse.json({ success: true, planId }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.twap.cancel', 60, 60_000);
  if (guard) return guard;
  const body = await readJson(request);
  const planId = String(body?.planId ?? request.nextUrl.searchParams.get('planId') ?? '');
  try {
    const result = getDb()
      .prepare("UPDATE dex_twap_plans SET status = 'cancelled' WHERE plan_id = ? AND user_id = ? AND status = 'active'")
      .run(planId, auth.user.userId);
    if (result.changes === 0) return fail('NO_PLAN', 'no active plan with that id', 404);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
