import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { swapHistory } from '@/lib/dex/swap-service';
import { dexFailure } from '@/lib/dex/route-helpers';
import { NO_STORE } from '@/lib/api/route-guards';

/** The caller's settled TigerSwap swaps, newest first. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
    return NextResponse.json({ success: true, swaps: swapHistory(auth.user.userId, limit) }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
