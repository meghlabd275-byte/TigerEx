import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { quoteHistory } from '@/lib/otc/quote';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's OTC quote history.
 *
 * Read from the exchange's own `otc_quotes` table; an account that has never
 * requested a quote gets an empty list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const quotes = quoteHistory(auth.user.userId, Number.isFinite(limit) ? limit : 50);

  return NextResponse.json({ success: true, quotes, data: quotes }, { headers: NO_STORE });
}
