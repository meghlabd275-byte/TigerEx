import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Approve or reject a KYC application.
 *
 * A rejection must carry a reason, because the applicant is told why. The
 * decision updates both the user record and their submitted documents and is
 * appended to the audit trail.
 */

const MAX_LEVEL = 3;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: targetUserId } = await params;
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.kyc.review');
  if (guard) return guard;

  const userId = targetUserId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) {
    return fail('VALIDATION_FAILED', 'Invalid user id');
  }

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const approve = body.approve === true;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!approve && reason.length === 0) {
    return fail('VALIDATION_FAILED', 'A rejection reason is required');
  }

  let level = 0;
  if (approve) {
    const parsed = Number(body.level ?? 2);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LEVEL) {
      return fail('VALIDATION_FAILED', `level must be an integer in [1, ${MAX_LEVEL}] when approving`);
    }
    level = parsed;
  }

  const db = getDb();
  const user = db.prepare('SELECT user_id, kyc_status FROM users WHERE user_id = ?').get(userId) as
    | { user_id: string; kyc_status: string }
    | undefined;
  if (!user) return fail('UNKNOWN_USER', 'No such user', 404);

  const now = new Date().toISOString();
  if (approve) {
    db.prepare(
      `UPDATE users
          SET kyc_level = ?, kyc_status = 'approved', kyc_verified_at = ?, kyc_rejection_reason = NULL,
              updated_at = datetime('now')
        WHERE user_id = ?`,
    ).run(String(level), now, userId);
  } else {
    db.prepare(
      `UPDATE users
          SET kyc_status = 'rejected', kyc_rejected_at = ?, kyc_rejection_reason = ?,
              updated_at = datetime('now')
        WHERE user_id = ?`,
    ).run(now, reason, userId);
  }

  db.prepare(
    `UPDATE kyc_documents
        SET status = ?, reviewed_at = ?, reviewer_id = ?, rejection_reason = ?
      WHERE user_id = ?`,
  ).run(approve ? 'approved' : 'rejected', now, auth.admin.adminId, approve ? null : reason, userId);

  recordAdminAction(request, auth.admin, approve ? 'kyc.approve' : 'kyc.reject', {
    type: 'user',
    id: userId,
    detail: approve ? { level } : { reason },
  });

  return NextResponse.json(
    { success: true, userId, status: approve ? 'approved' : 'rejected', level },
    { headers: NO_STORE },
  );
}
