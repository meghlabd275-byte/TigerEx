import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { depositAddress, userDepositAddresses, DepositError } from '@/lib/wallet/deposit';
import { fail, NO_STORE } from '@/lib/api/route-guards';

/**
 * The account's deposit address, or every address it holds.
 *
 * The address comes from the wallet row the exchange recorded, or is derived
 * from the custody master seed when the account has none yet. No address is
 * ever fabricated: when the seed is absent the route fails closed.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const coin = (request.nextUrl.searchParams.get('currency') ?? request.nextUrl.searchParams.get('coin') ?? '')
    .trim()
    .toUpperCase();
  const network = (request.nextUrl.searchParams.get('network') ?? '').trim().toUpperCase();

  if (!coin) {
    const addresses = userDepositAddresses(auth.user.userId);
    return NextResponse.json({ success: true, addresses, data: addresses }, { headers: NO_STORE });
  }

  try {
    const result = depositAddress(auth.user.userId, coin, network || coin);
    return NextResponse.json(
      { success: true, address: result.address, coin: result.asset, network: result.network, memo: result.memo },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof DepositError) return fail(error.code, error.message, error.status);
    console.error('Wallet address error:', error);
    return fail('INTERNAL_ERROR', 'The deposit address could not be resolved', 500);
  }
}
