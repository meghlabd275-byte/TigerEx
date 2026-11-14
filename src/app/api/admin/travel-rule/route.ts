import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE } from '@/lib/api/route-guards';
import {
  listTravelRuleMessages,
  travelRuleThresholdUsd,
  setTravelRuleThresholdUsd,
  TravelRuleError,
} from '@/lib/compliance/travel-rule';

/**
 * Travel-rule administration.
 *
 * GET lists the recorded FATF travel-rule messages (or those for one reference
 * id) and the current threshold. PUT sets the threshold. The messages carry
 * counterparty names, so this route is admin-only and never cached. Every
 * mutation is appended to the admin audit log.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') ?? 200);
  const referenceId = searchParams.get('referenceId') ?? undefined;
  return NextResponse.json(
    {
      success: true,
      thresholdUsd: travelRuleThresholdUsd(),
      messages: listTravelRuleMessages({ limit, referenceId }),
    },
    { headers: NO_STORE },
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const threshold = Number(body.thresholdUsd);
  try {
    setTravelRuleThresholdUsd(threshold);
  } catch (error) {
    if (error instanceof TravelRuleError) return fail(error.code, error.message, error.status);
    throw error;
  }
  recordAdminAction(request, auth.admin, 'travel_rule.set_threshold', { detail: { thresholdUsd: threshold } });
  return NextResponse.json({ success: true, thresholdUsd: threshold }, { headers: NO_STORE });
}
