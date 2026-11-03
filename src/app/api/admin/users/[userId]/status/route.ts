import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Lock or unlock a user account.
 *
 * The status is validated against the allowed set and the change is appended to
 * the audit trail. Locking a user also drops their sessions so an active
 * session cannot outlive the lock.
 */

const ALLOWED_STATUSES = ['active', 'locked', 'suspended'];

export async function PUT(
  request: NextRequest,
  { params }: { params: { userId: string } },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.users.status');
  if (guard) return guard;

  const userId = params.userId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) {
    return fail('VALIDATION_FAILED', 'Invalid user id');
  }

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const status = String(body.status ?? '').toLowerCase();
  if (!ALLOWED_STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${ALLOWED_STATUSES.join(', ')}`);
  }

  const db = getDb();
  const user = db.prepare('SELECT user_id, status FROM users WHERE user_id = ?').get(userId) as
    | { user_id: string; status: string }
    | undefined;
  if (!user) return fail('UNKNOWN_USER', 'No such user', 404);

  db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE user_id = ?").run(
    status,
    userId,
  );
  if (status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  recordAdminAction(request, auth.admin, 'user.status.update', {
    type: 'user',
    id: userId,
    detail: { from: user.status, to: status },
  });

  return NextResponse.json({ success: true, userId, status }, { headers: NO_STORE });
}
