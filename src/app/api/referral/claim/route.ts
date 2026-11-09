import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { payoutReferralCommissions } from '@/lib/db/referral';

/**
 * Claim the caller's pending referral commissions.
 *
 * Commissions are paid from the funded `referral_rewards` pool, never minted.
 * The payout is idempotent per commission: each row is marked `paid` in the
 * same transaction that debits the pool and credits the referrer, so a retry
 * cannot double-pay and a short pool simply leaves the rest pending.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'referral.claim');
  if (guard) return guard;

  const paid = payoutReferralCommissions(auth.user.userId);
  const totalPaid = paid.reduce((sum, row) => sum + row.amount, 0);

  return NextResponse.json(
    {
      success: true,
      paid: paid.map((row) => ({ commissionId: row.commissionId, amount: row.amount, currency: row.currency })),
      totalPaid,
    },
    { headers: NO_STORE },
  );
}
