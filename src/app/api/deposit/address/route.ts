import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { depositAddress, userDepositAddresses, DepositError } from '@/lib/wallet/deposit';
import { fail, NO_STORE } from '@/lib/api/route-guards';

/**
 * Deposit addresses.
 *
 * Without a coin the response lists the addresses the account already holds.
 * With a coin and network it returns that wallet's address, deriving one from
 * the custody master seed when the account does not have one yet. When the seed
 * is not configured the route fails closed rather than returning an address the
 * exchange cannot spend from.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const coin = (request.nextUrl.searchParams.get('coin') ?? request.nextUrl.searchParams.get('currency') ?? '')
    .trim()
    .toUpperCase();
  const network = (request.nextUrl.searchParams.get('network') ?? '').trim().toUpperCase();

  if (!coin) {
    const addresses = userDepositAddresses(auth.user.userId);
    return NextResponse.json({ success: true, addresses, data: addresses }, { headers: NO_STORE });
  }

  if (!network) return fail('VALIDATION_FAILED', 'A network is required when a coin is supplied');

  try {
    const result = depositAddress(auth.user.userId, coin, network);
    return NextResponse.json(
      {
        success: true,
        coin: result.asset,
        asset: result.asset,
        network: result.network,
        address: result.address,
        memo: result.memo,
        created: result.created,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof DepositError) return fail(error.code, error.message, error.status);
    console.error('Deposit address error:', error);
    return fail('INTERNAL_ERROR', 'The deposit address could not be resolved', 500);
  }
}
