import { NextRequest, NextResponse } from 'next/server';
import { listProducts } from '@/lib/earn/subscriptions';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Savings products.
 *
 * Reads the exchange's own `earn_products` table, so an empty result means no
 * product has been created yet, not that a backend is missing.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const asset = params.get('asset')?.trim().toUpperCase();
  const type = params.get('type') ?? params.get('productType') ?? undefined;

  let products = listProducts(type ?? undefined);
  if (asset) products = products.filter((product) => product.asset.toUpperCase() === asset);

  return NextResponse.json({ success: true, products, data: products }, { headers: NO_STORE });
}
