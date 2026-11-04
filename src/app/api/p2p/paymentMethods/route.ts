import { NextResponse } from 'next/server';
import { paymentMethods } from '@/lib/p2p/market';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The fiat payment methods currently offered by P2P ads.
 *
 * The list is derived from the live ads, so it is always a method a merchant
 * actually accepts rather than a fixed menu.
 */
export async function GET() {
  const methods = paymentMethods();
  return NextResponse.json(
    { success: true, methods, paymentMethods: methods, data: methods.map((name) => ({ name })) },
    { headers: NO_STORE },
  );
}
