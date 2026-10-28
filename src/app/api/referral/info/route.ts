import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { referralStats } from '@/lib/db/referral';

/** Referral program summary for the authenticated user: code, counts, earnings, tier. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    const stats = referralStats(auth.user.userId);
    return NextResponse.json(
      { success: true, data: stats },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Referral info error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
