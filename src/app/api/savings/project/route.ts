import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { NO_STORE, fail } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/** One savings product, including its real total subscribed. */
export async function GET(request: NextRequest) {
  const productId = (request.nextUrl.searchParams.get('productId') ?? request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!productId) return fail('VALIDATION_FAILED', 'A productId is required');

  const db = getDb();
  const row = db.prepare('SELECT * FROM earn_products WHERE product_id = ?').get(productId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return fail('UNKNOWN_PRODUCT', 'No such earn product', 404);

  const total = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM earn_subscriptions WHERE product_id = ? AND status = 'active'")
    .get(productId) as { total: number } | undefined;

  const project = {
    productId: row.product_id,
    id: row.product_id,
    name: row.name,
    productType: row.product_type,
    asset: row.asset,
    apy: row.apy,
    durationDays: row.duration_days ?? null,
    minAmount: row.min_amount,
    maxAmount: row.max_amount ?? null,
    cap: row.cap ?? null,
    totalSubscribed: Number(total?.total) || 0,
    status: row.status,
  };

  return NextResponse.json({ success: true, project, data: project }, { headers: NO_STORE });
}
