import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, finite, positive, NO_STORE } from '@/lib/api/route-guards';
import { fundEarnRewards, earnRewardFundBalance } from '@/lib/earn/subscriptions';
import { validateDualTerms, validateSharkTerms } from '@/lib/earn/products';

export const dynamic = 'force-dynamic';

/**
 * Earn product administration.
 *
 * Every product type shares one table: flexible, locked, the RYUSD vault, dual
 * investment, shark fin, auto-invest and launchpool. The APR is a fraction
 * (0.15 is 15%) and a locked product must carry a duration, because a locked
 * product without a maturity cannot be redeemed correctly.
 *
 * A structured product (dual investment, shark fin) additionally carries its
 * terms — a strike and direction, or a yield range — which are validated here so
 * the settlement engine always has terms it can price.
 */

const PRODUCT_TYPES = ['flexible', 'locked', 'vault', 'dual_investment', 'shark_fin', 'auto_invest', 'launchpool', 'defi_staking'];
const ASSETS = ['BTC', 'ETH', 'TGR', 'RUSD', 'USDT', 'USDC', 'RYUSD'];
const STATUSES = ['active', 'paused', 'closed'];

function structuredTerms(
  productType: string,
  raw: unknown,
): Record<string, unknown> | { error: string } | null {
  if (productType !== 'dual_investment' && productType !== 'shark_fin') return null;
  const params = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const valid = productType === 'dual_investment' ? validateDualTerms(params) : validateSharkTerms(params);
  return 'error' in valid ? { error: valid.error } : (valid as unknown as Record<string, unknown>);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status')?.trim();
  const clauses: string[] = [];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM earn_products${where} ORDER BY product_type, asset`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      products: rows.map((row) => ({
        productId: row.product_id,
        name: row.name,
        productType: row.product_type,
        asset: row.asset,
        apy: row.apy,
        durationDays: row.duration_days ?? null,
        minAmount: row.min_amount,
        maxAmount: row.max_amount ?? null,
        cap: row.cap ?? null,
        status: row.status,
        params: row.params ?? null,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Create or update an earn product. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.earn');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  // Fund the earn reward account for an asset. Rewards are paid only from what
  // this account holds, so a product whose asset is never funded pays nothing.
  if (body.action === 'fund') {
    const fundAsset = String(body.asset ?? '').toUpperCase();
    if (!ASSETS.includes(fundAsset)) return fail('VALIDATION_FAILED', `asset must be one of ${ASSETS.join(', ')}`);
    const fundAmount = finite(body.amount);
    if (fundAmount === null || fundAmount <= 0) return fail('VALIDATION_FAILED', 'amount must be a positive number');
    fundEarnRewards(fundAsset, fundAmount);
    recordAdminAction(request, auth.admin, 'earn.rewards.fund', {
      type: 'earn_reward_fund',
      id: fundAsset,
      detail: { asset: fundAsset, amount: fundAmount, balance: earnRewardFundBalance(fundAsset) },
    });
    return NextResponse.json(
      { success: true, asset: fundAsset, rewardFundBalance: earnRewardFundBalance(fundAsset) },
      { headers: NO_STORE },
    );
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > 120) {
    return fail('VALIDATION_FAILED', 'name is required and must be at most 120 characters');
  }

  const productType = String(body.productType ?? '').toLowerCase();
  if (!PRODUCT_TYPES.includes(productType)) {
    return fail('VALIDATION_FAILED', `productType must be one of ${PRODUCT_TYPES.join(', ')}`);
  }

  const asset = String(body.asset ?? '').toUpperCase();
  if (!ASSETS.includes(asset)) return fail('VALIDATION_FAILED', `asset must be one of ${ASSETS.join(', ')}`);

  const apy = finite(body.apy);
  if (apy === null || apy <= 0 || apy >= 5) {
    return fail('VALIDATION_FAILED', 'apy must be a fraction in (0, 5)');
  }

  const minAmount = finite(body.minAmount ?? 0);
  if (minAmount === null || minAmount < 0) return fail('VALIDATION_FAILED', 'minAmount must be a non-negative number');

  const maxAmount = body.maxAmount === undefined || body.maxAmount === null ? null : finite(body.maxAmount);
  if (body.maxAmount !== undefined && body.maxAmount !== null && (maxAmount === null || maxAmount <= 0)) {
    return fail('VALIDATION_FAILED', 'maxAmount must be a positive number when supplied');
  }
  if (maxAmount !== null && minAmount > maxAmount) {
    return fail('VALIDATION_FAILED', 'minAmount must not exceed maxAmount');
  }

  const cap = body.cap === undefined || body.cap === null ? null : finite(body.cap);
  if (body.cap !== undefined && body.cap !== null && (cap === null || cap <= 0)) {
    return fail('VALIDATION_FAILED', 'cap must be a positive number when supplied');
  }

  let durationDays: number | null = null;
  if (productType === 'locked') {
    const parsed = finite(body.durationDays);
    if (parsed === null || !Number.isInteger(parsed) || parsed <= 0 || parsed > 3650) {
      return fail('VALIDATION_FAILED', 'durationDays must be a positive integer for a locked product');
    }
    durationDays = parsed;
  } else if (body.durationDays !== undefined && body.durationDays !== null) {
    const parsed = finite(body.durationDays);
    if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
      return fail('VALIDATION_FAILED', 'durationDays must be a positive integer when supplied');
    }
    durationDays = parsed;
  }

  const status = String(body.status ?? 'active').toLowerCase();
  if (!STATUSES.includes(status)) return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);

  // A structured product must carry valid terms, and a term in days so it can
  // mature and settle.
  let paramsJson: string | null = null;
  if (productType === 'dual_investment' || productType === 'shark_fin') {
    if (durationDays === null || durationDays <= 0) {
      return fail('VALIDATION_FAILED', 'durationDays is required for a dual-investment or shark-fin product');
    }
    const terms = structuredTerms(productType, body.params);
    if (terms && 'error' in terms) return fail('VALIDATION_FAILED', terms.error as string);
    paramsJson = JSON.stringify(terms);
  }

  const db = getDb();
  const productId = typeof body.productId === 'string' && body.productId ? body.productId : null;

  if (productId) {
    const existing = db.prepare('SELECT product_id FROM earn_products WHERE product_id = ?').get(productId);
    if (!existing) return fail('UNKNOWN_PRODUCT', 'No such earn product', 404);
    db.prepare(
      `UPDATE earn_products
          SET name = ?, product_type = ?, asset = ?, apy = ?, duration_days = ?, min_amount = ?,
              max_amount = ?, cap = ?, status = ?, params = ?
        WHERE product_id = ?`,
    ).run(name, productType, asset, apy, durationDays, minAmount, maxAmount, cap, status, paramsJson, productId);
    recordAdminAction(request, auth.admin, 'earn.product.update', { type: 'earn_product', id: productId, detail: { name, productType, apy, status } });
    return NextResponse.json({ success: true, productId }, { headers: NO_STORE });
  }

  const newId = generateId();
  db.prepare(
    `INSERT INTO earn_products (product_id, name, product_type, asset, apy, duration_days, min_amount, max_amount, cap, status, params)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId, name, productType, asset, apy, durationDays, minAmount, maxAmount, cap, status, paramsJson);

  recordAdminAction(request, auth.admin, 'earn.product.create', { type: 'earn_product', id: newId, detail: { name, productType, apy, status } });
  return NextResponse.json({ success: true, productId: newId }, { status: 201, headers: NO_STORE });
}

/** Close an earn product. It is retained so existing subscriptions still resolve. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.earn.close');
  if (guard) return guard;

  const productId = request.nextUrl.searchParams.get('productId')?.trim();
  if (!productId || !/^[A-Za-z0-9_-]{1,64}$/.test(productId)) {
    return fail('VALIDATION_FAILED', 'productId query parameter is required');
  }

  const db = getDb();
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM earn_subscriptions WHERE product_id = ? AND status = 'active'")
    .get(productId) as { n: number };

  db.prepare("UPDATE earn_products SET status = 'closed' WHERE product_id = ?").run(productId);

  recordAdminAction(request, auth.admin, 'earn.product.close', {
    type: 'earn_product',
    id: productId,
    detail: { activeSubscriptions: active.n },
  });

  return NextResponse.json({ success: true, productId, status: 'closed', activeSubscriptions: active.n }, { headers: NO_STORE });
}
