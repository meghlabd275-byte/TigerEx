import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { redeem, tradeHistory, EtfError } from '@/lib/trading/etf-engine';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Leveraged-token redemptions.
 *
 * POST burns tokens at the live NAV and credits the settlement asset; GET lists
 * the caller's redemption records.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'blvt.redeem', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const symbol = String(body.tokenName ?? body.symbol ?? '').trim();
  const tokens = Number(body.tokens ?? body.quantity ?? body.amount);

  try {
    const result = redeem({ userId: auth.user.userId, symbol, tokens });
    return NextResponse.json({ success: true, result, data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EtfError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const records = tradeHistory(auth.user.userId, Number.isFinite(limit) ? limit : 100)
    .filter((row) => String(row.action) === 'redeem');
  return NextResponse.json({ success: true, records, data: records }, { headers: NO_STORE });
}
