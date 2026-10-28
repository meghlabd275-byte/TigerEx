import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listReferrals } from '@/lib/db/referral';

const MAX_LIMIT = 100;

/** Paginated list of users invited by the authenticated referrer. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const referrals = listReferrals(auth.user.userId, limit, offset);
    return NextResponse.json(
      { success: true, data: referrals },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Referral users error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
