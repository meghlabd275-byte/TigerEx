import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, finite, positive, upper, NO_STORE } from '@/lib/api/route-guards';

/**
 * Buyback and burn records.
 *
 * A buyback spends quote currency to buy back the native token and burn it. The
 * share of fee revenue that funds it is a setting; each execution is recorded so
 * the total burned can be reconciled against supply.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const records = db
    .prepare('SELECT * FROM buyback_records ORDER BY created_at DESC LIMIT 500')
    .all() as Array<Record<string, unknown>>;

  const totalBurned = db
    .prepare('SELECT asset, COALESCE(SUM(asset_burned), 0) AS burned FROM buyback_records GROUP BY asset')
    .all() as Array<{ asset: string; burned: number }>;

  const feeShare = db.prepare("SELECT value FROM system_settings WHERE key = 'buyback_fee_share'").get() as
    | { value: string }
    | undefined;

  return NextResponse.json(
    {
      success: true,
      feeShare: feeShare ? Number(feeShare.value) : null,
      totalBurned: totalBurned.map((row) => ({ asset: row.asset, burned: Number(row.burned) || 0 })),
      records: records.map((row) => ({
        recordId: row.record_id,
        asset: row.asset,
        quoteAsset: row.quote_asset,
        amountSpent: row.amount_spent,
        assetBought: row.asset_bought,
        assetBurned: row.asset_burned,
        feeShare: row.fee_share,
        txRef: row.tx_ref ?? null,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Record a buyback-and-burn execution. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.buyback');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const asset = upper(body.asset);
  if (!/^[A-Z0-9]{2,20}$/.test(asset)) return fail('VALIDATION_FAILED', 'asset is required');

  const quoteAsset = upper(body.quoteAsset ?? 'RUSD');
  if (!/^[A-Z0-9]{2,20}$/.test(quoteAsset)) return fail('VALIDATION_FAILED', 'quoteAsset must be a valid asset');
  if (quoteAsset === asset) return fail('VALIDATION_FAILED', 'asset and quoteAsset must differ');

  const amountSpent = positive(body.amountSpent);
  if (amountSpent === null) return fail('VALIDATION_FAILED', 'amountSpent must be a positive number');

  const assetBought = positive(body.assetBought);
  if (assetBought === null) return fail('VALIDATION_FAILED', 'assetBought must be a positive number');

  const assetBurned = positive(body.assetBurned ?? body.assetBought);
  if (assetBurned === null) return fail('VALIDATION_FAILED', 'assetBurned must be a positive number');
  if (assetBurned > assetBought) return fail('VALIDATION_FAILED', 'assetBurned cannot exceed assetBought');

  const feeShare = finite(body.feeShare ?? 0.5);
  if (feeShare === null || feeShare < 0 || feeShare > 1) {
    return fail('VALIDATION_FAILED', 'feeShare must be a fraction in [0, 1]');
  }

  const txRef = body.txRef === undefined || body.txRef === null ? null : String(body.txRef).slice(0, 200);

  const recordId = `bb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  getDb()
    .prepare(
      `INSERT INTO buyback_records (record_id, asset, quote_asset, amount_spent, asset_bought, asset_burned, fee_share, tx_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(recordId, asset, quoteAsset, amountSpent, assetBought, assetBurned, feeShare, txRef);

  recordAdminAction(request, auth.admin, 'buyback.record', {
    type: 'buyback',
    id: recordId,
    detail: { asset, quoteAsset, amountSpent, assetBought, assetBurned, feeShare },
  });

  return NextResponse.json({ success: true, recordId, assetBurned }, { status: 201, headers: NO_STORE });
}

/** Set the share of fee revenue that funds buybacks. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.buyback.settings');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const feeShare = finite(body.feeShare);
  if (feeShare === null || feeShare < 0 || feeShare > 1) {
    return fail('VALIDATION_FAILED', 'feeShare must be a fraction in [0, 1]');
  }

  getDb()
    .prepare(
      `INSERT INTO system_settings (key, value, category, updated_by, updated_at)
       VALUES ('buyback_fee_share', ?, 'treasury', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    )
    .run(String(feeShare), auth.admin.email);

  recordAdminAction(request, auth.admin, 'buyback.settings', { type: 'setting', id: 'buyback_fee_share', detail: { feeShare } });
  return NextResponse.json({ success: true, feeShare }, { headers: NO_STORE });
}
