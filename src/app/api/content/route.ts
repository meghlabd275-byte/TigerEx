import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Public site content: published banners and announcements.
 *
 * Read from the exchange's own `banners` and `announcements` tables, filtered
 * to published rows within their active window. Nothing is proxied to a second
 * backend, so the content an operator publishes is exactly what a visitor sees.
 */
function publishedBanners(placement: string | null) {
  const clauses = ["status = 'published'", "(starts_at IS NULL OR datetime(starts_at) <= datetime('now'))", "(ends_at IS NULL OR datetime(ends_at) >= datetime('now'))"];
  const params: string[] = [];
  if (placement) {
    clauses.push('placement = ?');
    params.push(placement);
  }
  const rows = getDb()
    .prepare(`SELECT banner_id, title, image_url, link_url, placement, starts_at, ends_at FROM banners WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 100`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.banner_id,
    title: row.title,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    placement: row.placement,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
  }));
}

function publishedAnnouncements() {
  const rows = getDb()
    .prepare("SELECT announcement_id, title, body, severity, published_at FROM announcements WHERE status = 'published' ORDER BY published_at DESC LIMIT 100")
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.announcement_id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    publishedAt: row.published_at ?? null,
  }));
}

export async function GET(request: NextRequest) {
  const placement = request.nextUrl.searchParams.get('placement');
  const banners = publishedBanners(placement);
  const announcements = publishedAnnouncements();
  return NextResponse.json({ success: true, banners, announcements, data: { banners, announcements } }, { headers: NO_STORE });
}
