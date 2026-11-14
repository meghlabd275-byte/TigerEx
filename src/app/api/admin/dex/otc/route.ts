import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { enforceRequestGuards, readJson, fail, NO_STORE, upper } from '@/lib/api/route-guards';
import { fundOtcDesk, otcDeskBalance } from '@/lib/otc/quote';

export const dynamic = 'force-dynamic';

/**
 * OTC desk administration.
 *
 * The desk holds the venue's own inventory for block trades. An administrator
 * moves tokens in from the treasury; every fill then delivers from that real
 * inventory, so the desk can never conjure what it does not hold.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const rows = getDb()
    .prepare("SELECT asset, balance FROM treasury_accounts WHERE network = 'TIGEREX' AND account_type LIKE 'dex_otc_desk:%' ORDER BY asset")
    .all() as Array<{ asset: string; balance: number }>;
  const quotes = getDb()
    .prepare('SELECT quote_id, user_id, symbol, side, amount, quote_price, fee, status, expires_at, created_at FROM otc_quotes ORDER BY created_at DESC LIMIT 100')
    .all() as Array<Record<string, unknown>>;
  return NextResponse.json({ success: true, inventory: rows, quotes }, { headers: NO_STORE });
}

/** Move inventory into the desk account so it can fill client blocks. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.dex.otc.fund');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  const asset = upper(body.asset);
  const amount = Number(body.amount);
  if (!asset) return fail('VALIDATION_FAILED', 'asset is required');
  if (!Number.isFinite(amount) || amount <= 0) return fail('VALIDATION_FAILED', 'amount must be a positive number');

  fundOtcDesk(asset, amount);
  recordAdminAction(request, auth.admin, 'dex.otc.fund', { type: 'dex_otc_desk', id: asset, detail: { amount } });
  return NextResponse.json(
    { success: true, asset, funded: amount, deskBalance: otcDeskBalance(asset) },
    { status: 201, headers: NO_STORE },
  );
}
