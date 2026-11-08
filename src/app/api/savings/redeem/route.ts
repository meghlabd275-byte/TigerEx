import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { redeem, SubscriptionError } from '@/lib/earn/subscriptions';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Redeem a savings subscription.
 *
 * A locked subscription is refused before it matures; otherwise the principal
 * is released and the accrued reward credited in one transaction.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'savings.redeem', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const subscriptionId = String(body.subscriptionId ?? body.id ?? '').trim();

  try {
    const result = redeem(auth.user.userId, subscriptionId);
    return NextResponse.json({ success: true, result, data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SubscriptionError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
