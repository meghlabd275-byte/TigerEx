import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listOrderPlans, cancelOrderPlan, SpotError } from '@/lib/trading/spot-engine';
import { fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/** The caller's TWAP and scale plans. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const plans = listOrderPlans(auth.user.userId);
  return NextResponse.json({ success: true, plans }, { headers: NO_STORE });
}

/** Cancel an active plan. Slices already placed are real orders and are not recalled. */
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'order.cancel');
  if (guard) return guard;

  const planId = request.nextUrl.searchParams.get('planId')?.trim();
  if (!planId) return fail('VALIDATION_FAILED', 'planId query parameter is required');

  try {
    const plan = cancelOrderPlan(auth.user.userId, planId);
    return NextResponse.json({ success: true, plan }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SpotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
