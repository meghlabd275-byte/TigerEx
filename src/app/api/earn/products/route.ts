import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { subscribe, SubscriptionError } from '@/lib/earn/subscriptions';
import { LedgerError } from '@/lib/db/ledger';

export const dynamic = 'force-dynamic';

/**
 * Earn products and subscriptions.
 *
 * GET lists the exchange's own earn products; POST subscribes the caller to
 * one. The subscription itself is created by the earn engine's `subscribe`, so
 * the product cap, minimum, maximum and lock are enforced in one place rather
 * than re-implemented here where a check could drift out of step.
 */
export async function GET(request: NextRequest) {
  const productType = request.nextUrl.searchParams.get('type')?.trim().toLowerCase();

  const clauses: string[] = ["status = 'active'"];
  const params: string[] = [];
  if (productType) {
    clauses.push('product_type = ?');
    params.push(productType);
  }

  const rows = getDb()
    .prepare(`SELECT * FROM earn_products WHERE ${clauses.join(' AND ')} ORDER BY product_type, asset`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      products: rows.map((row) => ({
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
        status: row.status,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'earn.subscribe');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const productId = String(body.productId ?? '').trim();
  if (!productId) return fail('VALIDATION_FAILED', 'productId is required');

  try {
    const subscription = subscribe({ userId: auth.user.userId, productId, amount: Number(body.amount) });
    return NextResponse.json({ success: true, ...subscription }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof SubscriptionError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
