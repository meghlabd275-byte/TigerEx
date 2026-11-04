import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { internalTransfer, transferHistory, TransferError } from '@/lib/wallet/transfers';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Internal transfers between accounts.
 *
 * POST moves funds to the recipient named by email or phone; GET lists the
 * caller's own transfer history. The recipient must be a real account and the
 * sender must hold the funds, so nothing is parked or fabricated.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'wallet.transfers', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const recipient = String(body.recipient ?? body.toEmail ?? body.to ?? '').trim();
  const asset = String(body.coin ?? body.asset ?? body.currency ?? '').trim().toUpperCase();
  const amount = Number(body.amount);

  if (!recipient) return fail('VALIDATION_FAILED', 'A recipient email or phone is required');
  if (!asset) return fail('VALIDATION_FAILED', 'An asset is required');

  try {
    const result = internalTransfer(auth.user.userId, recipient, asset, amount);
    return NextResponse.json(
      {
        success: true,
        id: result.transferId,
        transfer_id: result.transferId,
        asset: result.asset,
        amount: result.amount,
        recipient: result.recipient,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof TransferError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    console.error('Transfer error:', error);
    return fail('INTERNAL_ERROR', 'The transfer could not be completed', 500);
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const transfers = transferHistory(auth.user.userId, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, transfers, transactions: transfers, data: transfers }, { headers: NO_STORE });
}
