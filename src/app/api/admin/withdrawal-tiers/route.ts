import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { withdrawalApprovalTiers, setWithdrawalApprovalTiers } from '@/lib/wallet/approvals';

/**
 * Withdrawal approval-tier administration (maker-checker policy).
 *
 * GET lists the tiers; PUT replaces them. A tier sets how many *distinct* admin
 * approvals a withdrawal at or above its USD value needs. An empty table is the
 * default single approval. Validation is fail-closed: counts must be positive
 * integers and must not decrease as the value rises.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  return NextResponse.json({ success: true, tiers: withdrawalApprovalTiers() }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.withdrawal_tiers.write');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body || !Array.isArray(body.tiers)) return fail('INVALID_BODY', 'A tiers array is required');

  const tiers = (body.tiers as Array<Record<string, unknown>>).map((tier) => ({
    minUsd: Number(tier.minUsd),
    requiredApprovals: Number(tier.requiredApprovals),
  }));

  try {
    setWithdrawalApprovalTiers(tiers);
  } catch (error) {
    return fail('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid tiers');
  }
  recordAdminAction(request, auth.admin, 'withdrawal_tiers.set', { detail: { tiers } });
  return NextResponse.json({ success: true, tiers: withdrawalApprovalTiers() }, { headers: NO_STORE });
}
