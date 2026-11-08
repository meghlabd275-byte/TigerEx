import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listPositions, openPosition, closePosition, OptionsError } from '@/lib/options/options-engine';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's options positions, and opening or closing one.
 *
 * A long pays the model premium; a short posts it as collateral. Both move
 * through the ledger inside one transaction with the position row, so a
 * position can never be opened without the funds to back it.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status')?.trim().toLowerCase();
  const positions = listPositions(auth.user.userId, status ? { status } : {});
  return NextResponse.json({ success: true, positions, data: positions }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'options.position.open', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const symbol = String(body.symbol ?? '').trim();
  const side = String(body.side ?? 'long').trim().toLowerCase();
  const quantity = Number(body.quantity ?? body.amount);

  try {
    const position = openPosition({ userId: auth.user.userId, symbol, side: side === 'short' ? 'short' : 'long', quantity });
    return NextResponse.json({ success: true, position, data: position }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof OptionsError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'options.position.close', 60, 60_000);
  if (guard) return guard;

  const symbol = (request.nextUrl.searchParams.get('symbol') ?? '').trim();
  const side = (request.nextUrl.searchParams.get('side') ?? 'long').trim().toLowerCase();
  const quantityParam = request.nextUrl.searchParams.get('quantity');
  const quantity = quantityParam === null ? undefined : Number(quantityParam);

  try {
    const result = closePosition({ userId: auth.user.userId, symbol, side: side === 'short' ? 'short' : 'long', quantity });
    return NextResponse.json({ success: true, result, data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof OptionsError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
