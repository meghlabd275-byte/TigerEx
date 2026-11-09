import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { listNft, buyNft, listNftListings } from '@/lib/dex/launch-service';
import { dexFailure } from '@/lib/dex/route-helpers';

/** List the marketplace listings. */
export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json({ success: true, listings: listNftListings() }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

/** List an NFT for sale, or buy one when `action` is `buy`. */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.nft', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    if (String(body.action ?? 'list').toLowerCase() === 'buy') {
      return NextResponse.json({ success: true, sale: buyNft(auth.user.userId, String(body.listingId ?? '')) }, { headers: NO_STORE });
    }
    const listingId = listNft({
      sellerId: auth.user.userId,
      collection: String(body.collection ?? ''),
      tokenId: String(body.tokenId ?? ''),
      price: Number(body.price),
      currency: String(body.currency ?? 'RUSD'),
    });
    return NextResponse.json({ success: true, listingId }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
