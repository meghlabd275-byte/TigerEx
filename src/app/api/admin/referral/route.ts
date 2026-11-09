import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, finite, NO_STORE } from '@/lib/api/route-guards';
import {
  fundReferralPool,
  referralPoolBalance,
  payoutReferralCommissions,
} from '@/lib/db/referral';

/**
 * Referral commission pool administration.
 *
 * Commissions are recorded `pending` as referees trade; this endpoint funds the
 * pool that pays them and reports what it holds. A payout is never minted, so
 * the pool must be funded before a referrer's `referral/claim` can succeed.
 */

const ASSETS = ['BTC', 'ETH', 'BNB', 'SOL', 'USDT', 'USDC', 'RUSD', 'TGR'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json(
    {
      success: true,
      pool: Object.fromEntries(ASSETS.map((asset) => [asset, referralPoolBalance(asset)])),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.referral');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const action = String(body.action ?? 'fund').toLowerCase();
  if (action !== 'fund') return fail('VALIDATION_FAILED', 'action must be fund');

  const asset = String(body.asset ?? '').toUpperCase();
  if (!ASSETS.includes(asset)) return fail('VALIDATION_FAILED', `asset must be one of ${ASSETS.join(', ')}`);

  const amount = finite(body.amount);
  if (amount === null || amount <= 0) return fail('VALIDATION_FAILED', 'amount must be a positive number');

  fundReferralPool(asset, amount);
  const balance = referralPoolBalance(asset);
  recordAdminAction(request, auth.admin, 'referral.pool.fund', {
    type: 'referral_reward_pool',
    id: asset,
    detail: { asset, amount, balance },
  });

  return NextResponse.json({ success: true, asset, poolBalance: balance }, { headers: NO_STORE });
}

/** Pay a referrer's pending commissions on their behalf (support action). */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.referral.payout');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const referrerId = String(body.referrerId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(referrerId)) return fail('VALIDATION_FAILED', 'referrerId is required');

  const paid = payoutReferralCommissions(referrerId);
  recordAdminAction(request, auth.admin, 'referral.payout', {
    type: 'referral_payout',
    id: referrerId,
    detail: { count: paid.length, total: paid.reduce((sum, row) => sum + row.amount, 0) },
  });

  return NextResponse.json(
    { success: true, referrerId, paid: paid.length, total: paid.reduce((sum, row) => sum + row.amount, 0) },
    { headers: NO_STORE },
  );
}
