import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Marketing banners.
 *
 * Banners are read from the exchange's own `banners` table. The storefront
 * filters them by placement and schedule; the console shows every row.
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

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rows = getDb()
    .prepare(
      `SELECT banner_id, title, image_url, link_url, placement, status, starts_at, ends_at, created_at
         FROM banners ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      data: rows.map((row) => ({
        id: row.banner_id,
        title: row.title,
        image_url: row.image_url,
        link_url: row.link_url,
        placement: row.placement,
        status: row.status,
        starts_at: row.starts_at ?? '',
        ends_at: row.ends_at ?? '',
        created_at: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.banners.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length === 0 || title.length > 200) {
    return fail('VALIDATION_FAILED', 'title is required and must be at most 200 characters');
  }

  const imageUrl = httpsUrl(body.image_url);
  if (!imageUrl) return fail('VALIDATION_FAILED', 'image_url must be an absolute https URL');

  const linkUrl = body.link_url === undefined || body.link_url === '' ? '' : httpsUrl(body.link_url);
  if (linkUrl === null) return fail('VALIDATION_FAILED', 'link_url must be an absolute https URL when supplied');

  const placement = String(body.placement ?? 'home').toLowerCase();
  if (!PLACEMENTS.includes(placement)) {
    return fail('VALIDATION_FAILED', `placement must be one of ${PLACEMENTS.join(', ')}`);
  }

  const status = String(body.status ?? 'draft').toLowerCase();
  if (!STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  const startsAt = typeof body.starts_at === 'string' && body.starts_at ? body.starts_at : null;
  const endsAt = typeof body.ends_at === 'string' && body.ends_at ? body.ends_at : null;
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    return fail('VALIDATION_FAILED', 'starts_at must be before ends_at');
  }

  const bannerId = generateId();
  getDb()
    .prepare(
      `INSERT INTO banners (banner_id, title, image_url, link_url, placement, status, starts_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(bannerId, title, imageUrl, linkUrl, placement, status, startsAt, endsAt);

  recordAdminAction(request, auth.admin, 'banner.create', {
    type: 'banner',
    id: bannerId,
    detail: { title, placement, status },
  });

  return NextResponse.json(
    { success: true, banner: { id: bannerId, title, image_url: imageUrl, link_url: linkUrl, placement, status } },
    { status: 201, headers: NO_STORE },
  );
}
