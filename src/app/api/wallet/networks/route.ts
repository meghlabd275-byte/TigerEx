import { NextRequest, NextResponse } from 'next/server';
import { listNetworks } from '@/lib/wallet/networks';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The deposit networks the exchange serves.
 *
 * Public: the deposit view needs the list before a user has signed in, and it
 * contains only operator configuration (asset, chain, minimum, confirmations),
 * never an account's own address. With `coin` it returns the active networks
 * for that asset alone.
 */
export async function GET(request: NextRequest) {
  const coin = (request.nextUrl.searchParams.get('coin') ?? request.nextUrl.searchParams.get('asset') ?? '')
    .trim()
    .toUpperCase();

  const all = listNetworks(coin ? {} : { status: 'active' });
  const networks = coin ? all.filter((row) => row.asset === coin && row.status === 'active') : all;

  return NextResponse.json(
    {
      success: true,
      coin: coin || null,
      networks,
      data: networks,
      items: networks,
    },
    { headers: NO_STORE },
  );
}
