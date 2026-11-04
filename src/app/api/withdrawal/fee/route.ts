import { NextRequest, NextResponse } from 'next/server';
import { withdrawalPolicy, withdrawalPolicies } from '@/lib/wallet/withdrawals';
import { NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * Withdrawal fee and limits for an asset on a network.
 *
 * The fee, minimum and maximum are the operator's configured policy. A chain
 * with no configured entry is reported as unavailable rather than being given
 * an invented fee, so a client can never quote a fee the exchange will not
 * honour.
 */
export async function GET(request: NextRequest) {
  const coin = (request.nextUrl.searchParams.get('coin') ?? '').trim().toUpperCase();
  const network = (request.nextUrl.searchParams.get('network') ?? '').trim().toUpperCase();

  if (!coin) return fail('VALIDATION_FAILED', 'A coin is required');

  if (!network) {
    const policies = withdrawalPolicies().filter((policy) => policy.asset === coin && policy.enabled);
    if (policies.length === 0) {
      return fail('CHAIN_NOT_CONFIGURED', `Withdrawals of ${coin} are not enabled`, 404);
    }
    return NextResponse.json({ success: true, coin, data: policies }, { headers: NO_STORE });
  }

  const policy = withdrawalPolicy(coin, network);
  if (!policy) {
    return fail('CHAIN_NOT_CONFIGURED', `Withdrawals of ${coin} on ${network} are not enabled`, 404);
  }

  return NextResponse.json(
    {
      success: true,
      coin,
      asset: policy.asset,
      network: policy.network,
      fee: policy.fee,
      min_withdraw: policy.minAmount,
      min: policy.minAmount,
      max: policy.maxAmount,
      enabled: policy.enabled,
      data: policy,
    },
    { headers: NO_STORE },
  );
}
