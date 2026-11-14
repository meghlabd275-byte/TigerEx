import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { marketMakerStatus, setMarketMakerConfig, MarketMakerError } from '@/lib/trading/venue-market-maker';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Venue market-maker administration.
 *
 * The desk is the venue's own liquidity provider. Enabling a market here turns
 * its quoting on; the desk then quotes a post-only bid and ask each scheduler
 * cycle, funded from its own inventory account. Disabling a market withdraws
 * its quotes immediately.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json({ success: true, markets: marketMakerStatus() }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.marketmaker');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const config = setMarketMakerConfig({
      symbol: String(body.symbol ?? '').trim().toUpperCase(),
      enabled: body.enabled === true,
      spread: Number(body.spread),
      quoteQuantity: Number(body.quoteQuantity ?? body.quote_quantity),
      maxInventory: Number(body.maxInventory ?? body.max_inventory),
      targetInventory:
        body.targetInventory === undefined && body.target_inventory === undefined
          ? undefined
          : Number(body.targetInventory ?? body.target_inventory),
      maxDeviation:
        body.maxDeviation === undefined && body.max_deviation === undefined
          ? undefined
          : Number(body.maxDeviation ?? body.max_deviation),
      targetPrice:
        body.targetPrice === undefined || body.targetPrice === null ? undefined : Number(body.targetPrice),
    });

    recordAdminAction(request, auth.admin, 'marketmaker.config', {
      type: 'market',
      id: config.symbol,
      detail: { enabled: config.enabled, spread: config.spread, quoteQuantity: config.quoteQuantity },
    });

    return NextResponse.json({ success: true, config }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MarketMakerError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
