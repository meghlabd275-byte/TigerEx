import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listAds, createAd, closeAd, P2pError } from '@/lib/p2p/market';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * P2P advertisements.
 *
 * GET is the public marketplace listing, so it needs no session: the ads are
 * public. POST creates the caller's own ad and escrows the advertised quantity
 * when it is a sell ad. DELETE closes the caller's own ad and returns any
 * escrow still held.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ads = listAds({
    asset: params.get('asset') ?? params.get('coin') ?? undefined,
    fiat: params.get('fiat') ?? params.get('fiatCurrency') ?? undefined,
    side: params.get('side') ?? params.get('type') ?? undefined,
    limit: Number(params.get('limit') ?? 200),
  });

  return NextResponse.json({ success: true, ads, data: ads }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'p2p.ads', 20, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const rawMethods = body.paymentMethods;
  const methods = Array.isArray(rawMethods)
    ? rawMethods.map((value) => String(value))
    : typeof rawMethods === 'string'
      ? rawMethods.split(',').map((value) => value.trim()).filter(Boolean)
      : [];

  try {
    const ad = createAd({
      userId: auth.user.userId,
      side: String(body.side ?? body.type ?? 'sell').toLowerCase() === 'buy' ? 'buy' : 'sell',
      asset: String(body.asset ?? body.coin ?? ''),
      fiat: String(body.fiat ?? body.fiatCurrency ?? ''),
      price: Number(body.price ?? body.fixedPrice),
      minAmount: Number(body.minAmount ?? body.min_amount),
      maxAmount: Number(body.maxAmount ?? body.max_amount),
      available: Number(body.available ?? body.amount),
      paymentMethods: methods,
    });
    return NextResponse.json({ success: true, ad, data: ad }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof P2pError) return fail(error.code, error.message, error.status);
    console.error('P2P ad error:', error);
    return fail('INTERNAL_ERROR', 'The ad could not be created', 500);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'p2p.ads');
  if (guard) return guard;

  const offerId = (request.nextUrl.searchParams.get('offerId') ?? request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!offerId) return fail('VALIDATION_FAILED', 'An ad id is required');

  try {
    closeAd(auth.user.userId, offerId);
    return NextResponse.json({ success: true, id: offerId }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof P2pError) return fail(error.code, error.message, error.status);
    console.error('P2P close error:', error);
    return fail('INTERNAL_ERROR', 'The ad could not be closed', 500);
  }
}
