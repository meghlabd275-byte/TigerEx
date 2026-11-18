import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, positive, NO_STORE } from '@/lib/api/route-guards';
import { fundOptionsPool, OptionsError } from '@/lib/options/options-engine';

export const dynamic = 'force-dynamic';

/**
 * The venue's options counterparty pool.
 *
 * Every option's premium is held here and every close or settlement is paid from
 * here, so the pool may only pay what it holds. An operator supplies it from
 * venue capital; the supply is journalled against the same `pool:options`
 * account a payout draws from. It never fabricates a balance.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rows = getDb()
    .prepare(
      `SELECT asset, balance, updated_at FROM treasury_accounts
        WHERE network = 'TIGEREX' AND account_type = 'options_pool' ORDER BY asset`,
    )
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      pools: rows.map((row) => ({
        asset: row.asset,
        balance: Number(row.balance) || 0,
        updatedAt: row.updated_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Supply an asset to the options pool so settlements can be paid. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.options.pool');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const asset = String(body.asset ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(asset)) {
    return fail('VALIDATION_FAILED', 'asset must be an uppercase ticker');
  }
  const amount = positive(body.amount);
  if (amount === null) return fail('VALIDATION_FAILED', 'amount must be a positive number');

  try {
    const balance = fundOptionsPool(asset, amount);
    recordAdminAction(request, auth.admin, 'options.pool.fund', {
      type: 'options_pool',
      id: asset,
      detail: { asset, amount, balance },
    });
    return NextResponse.json({ success: true, pool: { asset, balance } }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof OptionsError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
