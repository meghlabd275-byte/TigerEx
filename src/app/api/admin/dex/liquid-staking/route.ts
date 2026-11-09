import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { validateLiquidStakingInput } from '@/lib/dex/validation';
import { dexFailure } from '@/lib/dex/route-helpers';
import { listLiquidStaking, distributeRewards, fundLiquidStakingRewards, liquidRewardBalance } from '@/lib/dex/liquid-staking-service';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap liquid-staking administration.
 *
 * Create a staking pool, pause or resume it, and distribute rewards. Rewards
 * raise the stTGR exchange rate; the service refuses them when no stTGR is
 * outstanding, so an operator cannot create value for a first depositor out of
 * nothing. Every mutation is audited.
 */
function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({ success: true, pools: listLiquidStaking() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const validated = validateLiquidStakingInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const pool = validated.value;

  const db = getDb();
  if (db.prepare('SELECT 1 FROM dex_liquid_staking WHERE name = ?').get(pool.name)) {
    return fail('DUPLICATE_STAKE', 'a staking pool with this name already exists', 409);
  }

  const stakeId = generateId();
  db.prepare(
    `INSERT INTO dex_liquid_staking (stake_id, name, stake_token, receipt_token, redemption_fee_bps, total_staked, total_shares, status)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(stakeId, pool.name, pool.stakeToken, pool.receiptToken, pool.redemptionFeeBps, pool.status);
  recordAdminAction(request, auth.admin, 'dex.liquid_staking.create', { type: 'dex_liquid_staking', id: stakeId, detail: pool });
  return NextResponse.json({ success: true, stakeId }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const db = getDb();
  const stakeId = String(body.stakeId ?? '');
  if (!db.prepare('SELECT 1 FROM dex_liquid_staking WHERE stake_id = ?').get(stakeId)) {
    return fail('UNKNOWN_STAKE', 'staking pool does not exist', 404);
  }

  const assignments: string[] = [];
  const params: unknown[] = [];
  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!['active', 'paused'].includes(status)) return fail('VALIDATION_FAILED', 'status must be one of active, paused');
    assignments.push('status = ?');
    params.push(status);
  }
  if (body.redemptionFeeBps !== undefined) {
    const fee = Number(body.redemptionFeeBps);
    if (!Number.isInteger(fee) || fee < 0 || fee >= 10_000) {
      return fail('VALIDATION_FAILED', 'redemptionFeeBps must be an integer in [0, 10000)');
    }
    assignments.push('redemption_fee_bps = ?');
    params.push(fee);
  }
  if (assignments.length === 0) return fail('VALIDATION_FAILED', 'no updatable field was supplied');

  params.push(stakeId);
  db.prepare(`UPDATE dex_liquid_staking SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE stake_id = ?`).run(...params);
  recordAdminAction(request, auth.admin, 'dex.liquid_staking.update', { type: 'dex_liquid_staking', id: stakeId, detail: body });
  return NextResponse.json({ success: true });
}

/** Fund a pool's reward account, or distribute rewards to raise the rate. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  // Rewards are real tokens: the operator funds the reward account first, then
  // distributes from it. Distribution fails closed when the account is short.
  if (String(body.action ?? '').toLowerCase() === 'fund-rewards') {
    const stakeToken = String(body.stakeToken ?? '').trim().toUpperCase();
    if (!stakeToken) return fail('VALIDATION_FAILED', 'stakeToken is required');
    try {
      fundLiquidStakingRewards(stakeToken, Number(body.amount ?? 0));
    } catch (error) {
      const dexError = error as { code?: string; message?: string; status?: number };
      return fail(dexError.code ?? 'INVALID_AMOUNT', dexError.message ?? 'could not fund rewards', dexError.status ?? 400);
    }
    recordAdminAction(request, auth.admin, 'dex.liquid_staking.fund', {
      type: 'dex_liquid_staking_reward',
      id: stakeToken,
      detail: { stakeToken, amount: Number(body.amount ?? 0) },
    });
    return NextResponse.json({ success: true, stakeToken, balance: liquidRewardBalance(stakeToken) }, { status: 201 });
  }

  const stakeId = String(body.stakeId ?? '');
  try {
    const result = distributeRewards(stakeId, Number(body.rewards ?? 0));
    recordAdminAction(request, auth.admin, 'dex.liquid_staking.rewards', { type: 'dex_liquid_staking', id: stakeId, detail: result });
    return NextResponse.json({ success: true, distribution: result });
  } catch (error) {
    return dexFailure(error);
  }
}
