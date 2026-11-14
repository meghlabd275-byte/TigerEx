import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import {
  fundMarketMaker,
  creditTreasuryInventory,
  marketMakerStatus,
  MarketMakerError,
} from '@/lib/trading/venue-market-maker';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Fund the venue market maker.
 *
 * Inventory is real balance moved into the desk's account, drawn from the
 * desk's own treasury account (`mm_inventory`). The treasury account is funded
 * separately (a deposit the venue actually holds), so the desk can never quote
 * inventory the venue does not have.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  return NextResponse.json({ success: true, markets: marketMakerStatus() }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.marketmaker.fund');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const action = String(body.action ?? 'fund').trim().toLowerCase();
  try {
    if (action === 'seed-treasury') {
      const asset = String(body.asset ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{1,20}$/.test(asset)) return fail('VALIDATION_FAILED', 'asset is required');
      const amount = Number(body.amount);
      creditTreasuryInventory(asset, amount);
      recordAdminAction(request, auth.admin, 'marketmaker.seed_treasury', {
        type: 'asset',
        id: asset,
        detail: { amount },
      });
      return NextResponse.json({ success: true, asset, amount }, { headers: NO_STORE });
    }

    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const baseAmount = Number(body.baseAmount ?? body.base_amount ?? 0);
    const quoteAmount = Number(body.quoteAmount ?? body.quote_amount ?? 0);
    const status = fundMarketMaker(symbol, baseAmount, quoteAmount);
    recordAdminAction(request, auth.admin, 'marketmaker.fund', {
      type: 'market',
      id: symbol,
      detail: { baseAmount, quoteAmount },
    });
    return NextResponse.json({ success: true, market: status }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MarketMakerError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
