import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { lockAvailable } from '@/lib/db/ledger';

/**
 * Earn products and subscriptions.
 *
 * GET lists the exchange's own earn products; POST subscribes the caller to
 * one. A subscription locks the principal in the user's balance so the same
 * funds cannot be spent while they earn, and the accrual itself is computed by
 * the earn engine from the product's APR.
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

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail('VALIDATION_FAILED', 'amount must be a positive number');
  }

  const db = getDb();
  const product = db.prepare("SELECT * FROM earn_products WHERE product_id = ? AND status = 'active'").get(productId) as
    | Record<string, unknown>
    | undefined;
  if (!product) return fail('UNKNOWN_PRODUCT', 'No such active earn product', 404);

  const minAmount = Number(product.min_amount) || 0;
  const maxAmount = product.max_amount === null || product.max_amount === undefined ? null : Number(product.max_amount);
  if (amount < minAmount) return fail('VALIDATION_FAILED', `Minimum subscription is ${minAmount}`);
  if (maxAmount !== null && amount > maxAmount) return fail('VALIDATION_FAILED', `Maximum subscription is ${maxAmount}`);

  const asset = String(product.asset);
  const durationDays = product.duration_days === null || product.duration_days === undefined ? null : Number(product.duration_days);

  try {
    const subscriptionId = generateId();
    const run = db.transaction(() => {
      lockAvailable(auth.user.userId, asset, amount);
      db.prepare(
        `INSERT INTO earn_subscriptions (subscription_id, user_id, product_id, amount, status, matures_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      ).run(
        subscriptionId,
        auth.user.userId,
        productId,
        amount,
        durationDays === null ? null : new Date(Date.now() + durationDays * 86400_000).toISOString(),
      );
    });
    run();

    return NextResponse.json(
      {
        success: true,
        subscriptionId,
        productId,
        asset,
        amount,
        maturesAt:
          durationDays === null ? null : new Date(Date.now() + durationDays * 86400_000).toISOString(),
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'INSUFFICIENT_BALANCE') return fail('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`, 400);
    throw error;
  }
}
