import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { usdPrice } from '@/lib/db/portfolio';
import { withdrawalPolicy } from '@/lib/wallet/withdrawals';
import { createWithdrawal, userWithdrawals, WithdrawalError } from '@/lib/wallet/withdrawals';
import { LedgerError } from '@/lib/db/ledger';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Create a withdrawal.
 *
 * The request is validated against the chain's configured policy and the real
 * address checksum, the user's KYC tier is checked for remaining headroom, and
 * the amount plus the fee is locked before the request is recorded. Nothing is
 * broadcast here: an operator approves it from the withdrawal queue.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'wallet.withdraw', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const coin = String(body.coin ?? body.asset ?? body.currency ?? '').trim().toUpperCase();
  const network = String(body.network ?? '').trim().toUpperCase();
  const address = String(body.address ?? '').trim();
  const memo = body.memo === undefined || body.memo === null ? null : String(body.memo);
  const amount = Number(body.amount);

  if (!coin) return fail('VALIDATION_FAILED', 'A coin is required');
  if (!network) return fail('VALIDATION_FAILED', 'A network is required');
  if (!address) return fail('VALIDATION_FAILED', 'A destination address is required');

  const policy = withdrawalPolicy(coin, network);
  if (!policy) {
    return fail('CHAIN_NOT_CONFIGURED', `Withdrawals of ${coin} on ${network} are not enabled`, 409);
  }

  try {
    const result = createWithdrawal({
      userId: auth.user.userId,
      kycLevel: auth.user.kycLevel,
      asset: coin,
      network,
      amount,
      fee: policy.fee,
      address,
      memo,
      usdPrice,
    });

    return NextResponse.json(
      {
        success: true,
        id: result.withdrawalId,
        withdrawal_id: result.withdrawalId,
        status: result.status,
        asset: result.asset,
        network: result.network,
        amount: result.amount,
        fee: result.fee,
        total: result.total,
        address: result.address,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof WithdrawalError) return fail(error.code, error.message, error.status);
    if (error instanceof LedgerError) return fail(error.code, error.message, error.status);
    console.error('Withdrawal error:', error);
    return fail('INTERNAL_ERROR', 'The withdrawal could not be created', 500);
  }
}

/** The caller's withdrawal history. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const asset = request.nextUrl.searchParams.get('coin') ?? request.nextUrl.searchParams.get('asset');
  const status = request.nextUrl.searchParams.get('status');
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);

  const withdrawals = userWithdrawals(auth.user.userId, {
    asset: asset ?? undefined,
    status: status ?? undefined,
    limit: Number.isFinite(limit) ? limit : 100,
  });

  return NextResponse.json({ success: true, withdrawals, data: withdrawals }, { headers: NO_STORE });
}
