import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { subscribe, SubscriptionError } from '@/lib/earn/subscriptions';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Purchase (subscribe to) a savings product.
 *
 * The principal is locked in the caller's balance and a subscription is
 * created; the reward accrues at the product's APR from the subscription time.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'savings.purchase', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const productId = String(body.productId ?? body.projectId ?? body.id ?? '').trim();
  const amount = Number(body.amount);

  try {
    const subscription = subscribe({ userId: auth.user.userId, productId, amount });
    return NextResponse.json({ success: true, subscription, data: subscription }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof SubscriptionError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
