import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { listOptionPools, createOptionPool, fundOptionPool } from '@/lib/dex/options-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap options-pool administration.
 *
 * An administrator creates a pool for one underlying and moves treasury
 * collateral into it. The pool can only write options up to the collateral it
 * actually holds, so funding the pool is what raises its capacity. Every
 * mutation is appended to the audit trail.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({ success: true, pools: listOptionPools() }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'admin.dex.options.create', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const pool = createOptionPool({
      underlying: String(body.underlying ?? ''),
      settlementAsset: String(body.settlementAsset ?? 'RUSD'),
      volatility: Number(body.volatility),
      riskFreeRate: body.riskFreeRate === undefined ? undefined : Number(body.riskFreeRate),
      feeBps: body.feeBps === undefined ? undefined : Number(body.feeBps),
      collateral: body.collateral === undefined ? undefined : Number(body.collateral),
    });
    recordAdminAction(request, auth.admin, 'dex.options.create', {
      type: 'dex_option_pool',
      id: pool.pool_id,
      detail: { underlying: pool.underlying, settlement: pool.settlement_asset, volatility: pool.volatility },
    });
    return NextResponse.json(
      { success: true, pool: listOptionPools().find((row) => row.poolId === pool.pool_id) },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

/** Move treasury collateral into a pool to raise its writing capacity. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'admin.dex.options.fund', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  const poolId = String(body.poolId ?? '');
  if (!poolId) return fail('VALIDATION_FAILED', 'poolId is required');

  try {
    const pool = fundOptionPool(poolId, Number(body.amount));
    recordAdminAction(request, auth.admin, 'dex.options.fund', {
      type: 'dex_option_pool',
      id: poolId,
      detail: { amount: Number(body.amount) },
    });
    return NextResponse.json(
      { success: true, pool: listOptionPools().find((row) => row.poolId === pool.pool_id) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}
