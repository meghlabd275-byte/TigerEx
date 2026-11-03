import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listOrderHistory } from '@/lib/trading/spot-engine';
import { symbolParam, NO_STORE } from '@/lib/api/route-guards';

/** The caller's spot order history, newest first. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const raw = request.nextUrl.searchParams.get('symbol');
  const symbol = raw === null ? null : symbolParam(raw);
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 100) || 100, 1), 1000);

  const orders = listOrderHistory(auth.user.userId, symbol, limit);
  return NextResponse.json({ success: true, orders }, { headers: NO_STORE });
}
