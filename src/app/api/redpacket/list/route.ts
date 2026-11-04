import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { userRedPackets } from '@/lib/earn/rewards';
import { NO_STORE } from '@/lib/api/route-guards';

/** The caller's own red packets. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const packets = userRedPackets(auth.user.userId);
  return NextResponse.json({ success: true, packets, data: packets }, { headers: NO_STORE });
}
