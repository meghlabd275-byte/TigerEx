import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { decryptSecret, verifyTotp } from '@/lib/security/totp';

/**
 * Verify a submitted authenticator code for a sensitive action.
 *
 * Returns a boolean only; it does not change account state. Callers that gate
 * an operation on a fresh code should call this immediately before performing it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const code = String(body.code ?? '').trim();
  if (!code) {
    return NextResponse.json(
      { success: false, error: { code: 'MISSING_CODE', message: 'Authenticator code is required' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const row = db
      .prepare('SELECT two_factor_secret, two_factor_enabled FROM users WHERE user_id = ?')
      .get(auth.user.userId) as { two_factor_secret: string | null; two_factor_enabled: number } | undefined;

    if (!row?.two_factor_enabled || !row.two_factor_secret) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_ENABLED', message: '2FA is not enabled for this account' } },
        { status: 400 },
      );
    }

    let secret: string;
    try {
      secret = decryptSecret(row.two_factor_secret);
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'SECRET_UNREADABLE', message: 'Stored secret could not be read' } },
        { status: 500 },
      );
    }

    const valid = verifyTotp(secret, code);
    return NextResponse.json({ success: true, data: { valid } });
  } catch (error) {
    console.error('2FA verify error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
