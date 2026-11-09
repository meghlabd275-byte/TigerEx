import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE, enforceRequestGuards } from '@/lib/api/route-guards';
import { validateSchedule } from '@/lib/dex/fee-engine';

/**
 * DEX fee and revenue-split administration.
 *
 * The splits are stored in `system_settings` under `dex_*` keys, which the
 * settlement services read on every trade, so a change here takes effect on the
 * next swap without a redeploy. Every schedule must sum to 10000 basis points.
 */
const SPLIT_KEYS = [
  'dex_swap_fee_split_lp_bps',
  'dex_swap_fee_split_vetgr_bps',
  'dex_swap_fee_split_treasury_bps',
  'dex_swap_fee_split_insurance_bps',
  'dex_swap_fee_split_burn_bps',
] as const;

const SCALAR_KEYS = [
  'dex_max_slippage',
  'dex_default_slippage',
  'dex_max_price_impact',
  'dex_settlement_fee_bps',
  'dex_gasless_free_swaps_per_day',
  'dex_flash_loan_fee',
  'dex_nft_fee_bps',
  'dex_bridge_fee_bps',
  'dex_insurance_fund_target',
] as const;

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const rows = getDb()
    .prepare(`SELECT key, value, updated_at FROM system_settings WHERE key LIKE 'dex_%' ORDER BY key`)
    .all() as Array<Record<string, unknown>>;
  return NextResponse.json({ success: true, settings: rows }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.dex.fees.put');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const db = getDb();
  const applied: string[] = [];

  // A swap-fee split must be supplied as a whole so the parts always sum to the
  // fee; a partial update could leave the split inconsistent.
  const splitValues = SPLIT_KEYS.map((key) => Number(body[key]));
  const provided = SPLIT_KEYS.filter((key) => body[key] !== undefined);
  if (provided.length > 0) {
    if (provided.length !== SPLIT_KEYS.length || splitValues.some((value) => !Number.isInteger(value))) {
      return fail('VALIDATION_FAILED', 'all swap-fee split parts must be supplied as integers');
    }
    const schedule = {
      lpBps: splitValues[0],
      vetgrBps: splitValues[1],
      treasuryBps: splitValues[2],
      insuranceBps: splitValues[3],
      burnBps: splitValues[4],
    };
    try {
      validateSchedule(schedule);
    } catch (error) {
      return fail('VALIDATION_FAILED', (error as Error).message);
    }
    SPLIT_KEYS.forEach((key, index) => {
      db.prepare(
        `INSERT INTO system_settings (key, value, category, updated_by, updated_at)
         VALUES (?, ?, 'dex', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
      ).run(key, String(splitValues[index]), auth.admin.email);
      applied.push(key);
    });
  }

  for (const key of SCALAR_KEYS) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < 0) {
      return fail('VALIDATION_FAILED', `${key} must be a non-negative number`);
    }
    if (key.endsWith('_bps') && !Number.isInteger(value)) {
      return fail('VALIDATION_FAILED', `${key} must be an integer`);
    }
    if (key.startsWith('dex_') && (key.includes('slippage') || key === 'dex_max_price_impact') && value >= 1) {
      return fail('VALIDATION_FAILED', `${key} must be a fraction below 1`);
    }
    db.prepare(
      `INSERT INTO system_settings (key, value, category, updated_by, updated_at)
       VALUES (?, ?, 'dex', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    ).run(key, String(value), auth.admin.email);
    applied.push(key);
  }

  if (applied.length === 0) return fail('NOTHING_TO_UPDATE', 'no recognised DEX fee setting was provided');
  recordAdminAction(request, auth.admin, 'dex.fees.update', { type: 'dex_settings', detail: applied });
  return NextResponse.json({ success: true, applied }, { headers: NO_STORE });
}
