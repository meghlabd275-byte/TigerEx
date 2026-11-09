import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { settleWithdrawal, WithdrawalError } from '@/lib/wallet/withdrawals';

/**
 * Approve or reject a pending withdrawal.
 *
 * Settlement is delegated to `settleWithdrawal`, which consumes the reserved
 * funds on approval and returns them on rejection across every balance row the
 * reservation was spread over, inside one database transaction.
 */

const ACTIONS = ['approve', 'reject'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ withdrawalId: string; action: string }> },
) {
  const { withdrawalId: withdrawalIdParam, action: actionParam } = await params;
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.withdrawals.action');
  if (guard) return guard;

  const withdrawalId = withdrawalIdParam;
  const action = actionParam?.toLowerCase();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(withdrawalId)) {
    return fail('VALIDATION_FAILED', 'Invalid withdrawal id');
  }
  if (!ACTIONS.includes(action)) {
    return fail('VALIDATION_FAILED', `action must be one of ${ACTIONS.join(', ')}`);
  }

  const body = await readJson(request);
  const txHash = body && typeof body.txHash === 'string' ? body.txHash.trim() : '';
  const reason = body && typeof body.reason === 'string' ? body.reason.trim() : '';

  try {
    const result = settleWithdrawal(withdrawalId, action as 'approve' | 'reject', { txHash: txHash || null });

    recordAdminAction(request, auth.admin, action === 'approve' ? 'withdrawal.approve' : 'withdrawal.reject', {
      type: 'withdrawal',
      id: withdrawalId,
      detail: action === 'approve' ? { txHash: txHash || null } : { reason: reason || null },
    });

    return NextResponse.json(
      { success: true, withdrawalId: result.withdrawalId, status: result.status },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof WithdrawalError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
