import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userAds } from '@/lib/p2p/market';
import { NO_STORE } from '@/lib/api/route-guards';

/** The caller's own P2P ads. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const ads = userAds(auth.user.userId, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, ads, data: ads }, { headers: NO_STORE });
}
