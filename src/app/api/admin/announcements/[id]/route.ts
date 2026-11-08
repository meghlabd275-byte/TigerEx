import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Update or delete one announcement.
 *
 * Moving an announcement to `published` stamps the publish time once; a later
 * edit does not reset it. Deleting removes the row and is audited.
 */

const SEVERITIES = ['info', 'warning', 'critical'];
const STATUSES = ['draft', 'published', 'archived'];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: announcementId } = await params;
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.announcements.update');
  if (guard) return guard;

  const id = announcementId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail('VALIDATION_FAILED', 'Invalid announcement id');

  const db = getDb();
  const existing = db.prepare('SELECT * FROM announcements WHERE announcement_id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return fail('UNKNOWN_ANNOUNCEMENT', 'No such announcement', 404);

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const title = body.title === undefined ? String(existing.title) : String(body.title).trim();
  if (title.length === 0 || title.length > 200) {
    return fail('VALIDATION_FAILED', 'title must be between 1 and 200 characters');
  }

  const text = body.body === undefined ? String(existing.body) : String(body.body).trim();
  if (text.length === 0 || text.length > 20000) {
    return fail('VALIDATION_FAILED', 'body must be between 1 and 20000 characters');
  }

  const severity = body.severity === undefined ? String(existing.severity) : String(body.severity).toLowerCase();
  if (!SEVERITIES.includes(severity)) {
    return fail('VALIDATION_FAILED', `severity must be one of ${SEVERITIES.join(', ')}`);
  }

  const status = body.status === undefined ? String(existing.status) : String(body.status).toLowerCase();
  if (!STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  const publishedAt =
    status === 'published' && !existing.published_at
      ? new Date().toISOString()
      : (existing.published_at as string | null) ?? null;

  db.prepare(
    `UPDATE announcements SET title = ?, body = ?, severity = ?, status = ?, published_at = ?
      WHERE announcement_id = ?`,
  ).run(title, text, severity, status, publishedAt, id);

  recordAdminAction(request, auth.admin, 'announcement.update', {
    type: 'announcement',
    id,
    detail: { title, severity, status },
  });

  return NextResponse.json({ success: true, announcement: { id, title, severity, status, published_at: publishedAt } }, { headers: NO_STORE });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: announcementId } = await params;
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.announcements.delete');
  if (guard) return guard;

  const id = announcementId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail('VALIDATION_FAILED', 'Invalid announcement id');

  const result = getDb().prepare('DELETE FROM announcements WHERE announcement_id = ?').run(id);
  if (result.changes === 0) return fail('UNKNOWN_ANNOUNCEMENT', 'No such announcement', 404);

  recordAdminAction(request, auth.admin, 'announcement.delete', { type: 'announcement', id });
  return NextResponse.json({ success: true, id }, { headers: NO_STORE });
}
