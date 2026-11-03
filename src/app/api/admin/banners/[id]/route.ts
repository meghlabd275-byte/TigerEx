import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Update or delete one banner.
 *
 * The banner id comes from the path; a non-existent id returns 404. Both
 * mutations are audited.
 */

const PLACEMENTS = ['home', 'trade', 'earn'];
const STATUSES = ['draft', 'active', 'paused'];

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.banners.update');
  if (guard) return guard;

  const id = params.id;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail('VALIDATION_FAILED', 'Invalid banner id');

  const db = getDb();
  const existing = db.prepare('SELECT * FROM banners WHERE banner_id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return fail('UNKNOWN_BANNER', 'No such banner', 404);

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const title = body.title === undefined ? String(existing.title) : String(body.title).trim();
  if (title.length === 0 || title.length > 200) {
    return fail('VALIDATION_FAILED', 'title must be between 1 and 200 characters');
  }

  const imageUrl = body.image_url === undefined ? String(existing.image_url) : httpsUrl(body.image_url);
  if (!imageUrl) return fail('VALIDATION_FAILED', 'image_url must be an absolute https URL');

  const linkUrl =
    body.link_url === undefined
      ? String(existing.link_url ?? '')
      : body.link_url === ''
        ? ''
        : httpsUrl(body.link_url);
  if (linkUrl === null) return fail('VALIDATION_FAILED', 'link_url must be an absolute https URL when supplied');

  const placement = body.placement === undefined ? String(existing.placement) : String(body.placement).toLowerCase();
  if (!PLACEMENTS.includes(placement)) {
    return fail('VALIDATION_FAILED', `placement must be one of ${PLACEMENTS.join(', ')}`);
  }

  const status = body.status === undefined ? String(existing.status) : String(body.status).toLowerCase();
  if (!STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  db.prepare(
    `UPDATE banners SET title = ?, image_url = ?, link_url = ?, placement = ?, status = ? WHERE banner_id = ?`,
  ).run(title, imageUrl, linkUrl, placement, status, id);

  recordAdminAction(request, auth.admin, 'banner.update', {
    type: 'banner',
    id,
    detail: { title, placement, status },
  });

  return NextResponse.json({ success: true, banner: { id, title, image_url: imageUrl, link_url: linkUrl, placement, status } }, { headers: NO_STORE });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.banners.delete');
  if (guard) return guard;

  const id = params.id;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail('VALIDATION_FAILED', 'Invalid banner id');

  const db = getDb();
  const result = db.prepare('DELETE FROM banners WHERE banner_id = ?').run(id);
  if (result.changes === 0) return fail('UNKNOWN_BANNER', 'No such banner', 404);

  recordAdminAction(request, auth.admin, 'banner.delete', { type: 'banner', id });
  return NextResponse.json({ success: true, id }, { headers: NO_STORE });
}
