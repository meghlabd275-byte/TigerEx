import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';

/** Report the authenticated user's current 2FA state. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    const row = db
      .prepare('SELECT two_factor_enabled, two_factor_type FROM users WHERE user_id = ?')
      .get(auth.user.userId) as { two_factor_enabled: number; two_factor_type: string } | undefined;

    return NextResponse.json(
      {
        success: true,
        data: {
          enabled: !!row?.two_factor_enabled,
          type: row?.two_factor_type ?? 'totp',
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('2FA status error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
