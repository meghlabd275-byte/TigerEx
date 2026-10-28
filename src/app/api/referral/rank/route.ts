import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { referralLeaderboard, referralStats } from '@/lib/db/referral';
import { requireSession } from '@/lib/db/session';

/** Referrer leaderboard plus the authenticated user's own position. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);

  try {
    const leaderboard = referralLeaderboard(limit);
    const stats = referralStats(auth.user.userId);

    const db = getDb();
    const mine = db
      .prepare(
        `SELECT COALESCE(SUM(commission_earned), 0) AS earned,
                COUNT(*) AS referrals
           FROM referrals WHERE referrer_id = ?`,
      )
      .get(auth.user.userId) as { earned: number; referrals: number };

    const better = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT referrer_id, COALESCE(SUM(commission_earned), 0) AS earned
             FROM referrals GROUP BY referrer_id
         ) WHERE earned > ?`,
      )
      .get(mine.earned) as { n: number };

    return NextResponse.json(
      {
        success: true,
        data: {
          leaderboard,
          me: {
            rank: better.n + 1,
            referrals: mine.referrals,
            earned: mine.earned,
            tier: stats.currentTier,
          },
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Referral rank error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
