import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { merchantProfile, P2pProfileError } from '@/lib/p2p/profile';
import { NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * A P2P merchant's public profile.
 *
 * The completion rate and order count come from the merchant's own settled P2P
 * orders, so an account with no trades shows a genuinely zero rate rather than
 * a fabricated rating. The caller may view their own profile or another user's.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const requested = request.nextUrl.searchParams.get('userId')?.trim();
  const userId = requested && requested.length > 0 ? requested : auth.user.userId;

  try {
    const profile = merchantProfile(userId);
    return NextResponse.json({ success: true, profile, data: profile }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof P2pProfileError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
