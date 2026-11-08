import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { tradeHistory } from '@/lib/options/options-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/** The caller's options fills and settlements, newest first. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const records = tradeHistory(auth.user.userId, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ success: true, records, data: records }, { headers: NO_STORE });
}
