import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { settleWithdrawal, WithdrawalError } from '@/lib/wallet/withdrawals';
import { broadcastWithdrawal, PayoutError } from '@/lib/wallet/payout';
import { recordWithdrawalApproval, withdrawalApprovalState } from '@/lib/wallet/approvals';

/**
 * Approve, reject or broadcast a pending withdrawal.
 *
 * `approve` and `reject` settle the internal ledger through `settleWithdrawal`,
 * which consumes the reserved funds on approval and returns them on rejection
 * across every balance row the reservation was spread over.
 *
 * `broadcast` is the on-chain step: it signs and sends the transaction from the
 * exchange's custody key and consumes the reservation in the same transaction
 * that records the hash. A broadcast withdrawal is then settled automatically
 * once it is mined, so approval afterwards only records the outcome.
 */

const ACTIONS = ['approve', 'reject', 'broadcast'];

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
    // Maker-checker. An approval is a real operator action, so it is recorded
    // first; settlement only proceeds once the withdrawal's value tier is
    // satisfied by that many distinct operators. A rejection is immediate
    // because it moves no funds out.
    if (action === 'approve') {
      const state = recordWithdrawalApproval(withdrawalId, auth.admin.email);
      if (!state.satisfied) {
        recordAdminAction(request, auth.admin, 'withdrawal.approve.pending', {
          type: 'withdrawal',
          id: withdrawalId,
          detail: { received: state.received, required: state.required },
        });
        return NextResponse.json(
          {
            success: true,
            withdrawalId,
            status: 'pending',
            approvals: { received: state.received, required: state.required },
            message: `This withdrawal needs ${state.required} distinct approvals before it can settle`,
          },
          { headers: NO_STORE },
        );
      }
    }

    if (action === 'broadcast') {
      const state = withdrawalApprovalState(withdrawalId);
      if (!state.satisfied) {
        return fail(
          'APPROVALS_REQUIRED',
          `This withdrawal needs ${state.required} distinct approvals before it can be broadcast (has ${state.received})`,
          403,
        );
      }
      const result = await broadcastWithdrawal(withdrawalId);
      recordAdminAction(request, auth.admin, 'withdrawal.broadcast', {
        type: 'withdrawal',
        id: withdrawalId,
        detail: { txHash: result.txHash },
      });
      return NextResponse.json(
        { success: true, withdrawalId: result.withdrawalId, txHash: result.txHash, status: 'broadcast' },
        { headers: NO_STORE },
      );
    }

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
    if (error instanceof PayoutError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
