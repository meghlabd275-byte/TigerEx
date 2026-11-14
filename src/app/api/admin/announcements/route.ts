import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Operator announcements.
 *
 * The body is stored as plain text and rendered as text by the client, so no
 * markup is interpreted. Publishing stamps the publish time.
 */

const SEVERITIES = ['info', 'warning', 'critical'];
const STATUSES = ['draft', 'published', 'archived'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rows = getDb()
    .prepare(
      `SELECT announcement_id, title, body, severity, status, published_at, created_at
         FROM announcements ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      data: rows.map((row) => ({
        id: row.announcement_id,
        title: row.title,
        body: row.body,
        severity: row.severity,
        status: row.status,
        published_at: row.published_at ?? '',
        created_at: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.announcements.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length === 0 || title.length > 200) {
    return fail('VALIDATION_FAILED', 'title is required and must be at most 200 characters');
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length === 0 || text.length > 20000) {
    return fail('VALIDATION_FAILED', 'body is required and must be at most 20000 characters');
  }

  const severity = String(body.severity ?? 'info').toLowerCase();
  if (!SEVERITIES.includes(severity)) {
    return fail('VALIDATION_FAILED', `severity must be one of ${SEVERITIES.join(', ')}`);
  }

  const status = String(body.status ?? 'draft').toLowerCase();
  if (!STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  const announcementId = generateId();
  const publishedAt = status === 'published' ? new Date().toISOString() : null;
  getDb()
    .prepare(
      `INSERT INTO announcements (announcement_id, title, body, severity, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(announcementId, title, text, severity, status, publishedAt);

  recordAdminAction(request, auth.admin, 'announcement.create', {
    type: 'announcement',
    id: announcementId,
    detail: { title, severity, status },
  });

  return NextResponse.json(
    { success: true, announcement: { id: announcementId, title, severity, status, published_at: publishedAt } },
    { status: 201, headers: NO_STORE },
  );
}
