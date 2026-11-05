import { NextRequest } from 'next/server';
import { requireApiKey, v1Error, v1Ok } from '@/lib/api/v1-guard';
import { usdPrice } from '@/lib/db/portfolio';
import { withdrawalPolicy, createWithdrawal, WithdrawalError } from '@/lib/wallet/withdrawals';
import { LedgerError } from '@/lib/db/ledger';

/**
 * Request a withdrawal.
 *
 * Requires the `withdraw` permission. The amount plus the fee is locked against
 * the real balance and the request is queued for operator approval; nothing is
 * broadcast here, and the API key's owner is the only account that can be
 * debited.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const auth = await requireApiKey(request, 'withdraw', body);
  if ('error' in auth) return auth.error;

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(body || '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return v1Error('INVALID_BODY', 'A JSON object body is required');
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return v1Error('INVALID_BODY', 'The request body is not valid JSON');
  }

  const coin = String(parsed.coin ?? parsed.asset ?? '').trim().toUpperCase();
  const network = String(parsed.network ?? '').trim().toUpperCase();
  const address = String(parsed.address ?? '').trim();
  const memo = parsed.memo === undefined || parsed.memo === null ? null : String(parsed.memo);
  const amount = Number(parsed.amount);

  if (!coin) return v1Error('VALIDATION_FAILED', 'A coin is required');
  if (!network) return v1Error('VALIDATION_FAILED', 'A network is required');
  if (!address) return v1Error('VALIDATION_FAILED', 'A destination address is required');

  const policy = withdrawalPolicy(coin, network);
  if (!policy) return v1Error('CHAIN_NOT_CONFIGURED', `Withdrawals of ${coin} on ${network} are not enabled`, 409);

  try {
    const result = createWithdrawal({
      userId: auth.identity.userId,
      kycLevel: '0',
      asset: coin,
      network,
      amount,
      fee: policy.fee,
      address,
      memo,
      usdPrice,
    });
    return v1Ok({ withdrawal: result });
  } catch (error) {
    if (error instanceof WithdrawalError) return v1Error(error.code, error.message, error.status);
    if (error instanceof LedgerError) return v1Error(error.code, error.message, error.status);
    throw error;
  }
}
