import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userCoupons, redeemCoupon, RewardsError } from '@/lib/earn/rewards';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's coupons and coupon redemption.
 *
 * GET lists the coupons issued to the account. POST redeems one by code; a code
 * can only be redeemed once, by the account it was issued to, before it expires.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const coupons = userCoupons(auth.user.userId);
  return NextResponse.json({ success: true, coupons, data: coupons }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'coupons.redeem', 20, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const code = String(body?.code ?? '').trim();
  if (!code) return fail('VALIDATION_FAILED', 'A coupon code is required');

  try {
    const coupon = redeemCoupon(auth.user.userId, code);
    return NextResponse.json({ success: true, coupon, data: coupon }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RewardsError) return fail(error.code, error.message, error.status);
    console.error('Coupon error:', error);
    return fail('INTERNAL_ERROR', 'The coupon could not be redeemed', 500);
  }
}
