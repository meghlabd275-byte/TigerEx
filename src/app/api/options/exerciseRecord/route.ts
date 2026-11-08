import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { tradeHistory } from '@/lib/options/options-engine';
import { NO_STORE } from '@/lib/api/route-guards';

/** The caller's options settlements (exercises), newest first. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const records = tradeHistory(auth.user.userId, 500).filter((row) => String(row.action) === 'settle');
  return NextResponse.json({ success: true, records, data: records }, { headers: NO_STORE });
}
