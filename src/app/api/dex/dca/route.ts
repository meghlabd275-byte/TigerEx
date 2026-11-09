import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { getDb, generateId } from '@/lib/db';
import { dexFailure } from '@/lib/dex/route-helpers';
import { loadPool } from '@/lib/dex/pool-service';
import { frequencyMs, type DcaFrequency } from '@/lib/dex/orders';

/**
 * Dollar-cost-averaging plans.
 *
 * A plan buys a fixed amount of the output token on a schedule; the keeper runs
 * the due slices through the swap service. A plan is refused when the pool does
 * not hold the requested pair or the schedule is not a known frequency.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    const plans = getDb()
      .prepare('SELECT * FROM dex_dca_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
      .all(auth.user.userId) as Array<Record<string, unknown>>;
    return NextResponse.json({ success: true, plans }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.dca.create', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    const pool = loadPool(String(body.poolId ?? ''));
    const frequency = String(body.frequency ?? 'daily').toLowerCase();
    try {
      frequencyMs(frequency as DcaFrequency);
    } catch {
      return fail('INVALID_FREQUENCY', 'frequency must be one of hourly, daily, weekly, monthly');
    }
    const amountPerSlice = Number(body.amountPerSlice);
    const totalSlices = Number(body.totalSlices);
    if (!Number.isFinite(amountPerSlice) || amountPerSlice <= 0) return fail('INVALID_AMOUNT', 'amountPerSlice must be positive');
    if (!Number.isInteger(totalSlices) || totalSlices <= 0) return fail('INVALID_SLICES', 'totalSlices must be a positive integer');

    const planId = generateId();
    getDb()
      .prepare(
        `INSERT INTO dex_dca_plans (plan_id, pool_id, user_id, token_in, token_out, amount_per_slice, frequency, total_slices, start_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        planId,
        pool.pool_id,
        auth.user.userId,
        String(body.tokenIn ?? '').toUpperCase(),
        String(body.tokenOut ?? '').toUpperCase(),
        amountPerSlice,
        frequency,
        totalSlices,
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
  const guard = enforceRequestGuards(request, 'dex.dca.cancel', 60, 60_000);
  if (guard) return guard;
  const body = await readJson(request);
  const planId = String(body?.planId ?? request.nextUrl.searchParams.get('planId') ?? '');
  try {
    const result = getDb()
      .prepare("UPDATE dex_dca_plans SET status = 'cancelled' WHERE plan_id = ? AND user_id = ? AND status = 'active'")
      .run(planId, auth.user.userId);
    if (result.changes === 0) return fail('NO_PLAN', 'no active plan with that id', 404);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
