import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { subscribe, tradeHistory, EtfError } from '@/lib/trading/etf-engine';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Leveraged-token subscriptions.
 *
 * POST debits the settlement asset and mints tokens at the live NAV; GET lists
 * the caller's subscription records.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'blvt.subscribe', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const symbol = String(body.tokenName ?? body.symbol ?? '').trim();
  const amount = Number(body.amount ?? body.quantity);

  try {
    const position = subscribe({ userId: auth.user.userId, symbol, amount });
    return NextResponse.json({ success: true, position, data: position }, { status: 201, headers: NO_STORE });
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
    .filter((row) => String(row.action) === 'subscribe');
  return NextResponse.json({ success: true, records, data: records }, { headers: NO_STORE });
}
