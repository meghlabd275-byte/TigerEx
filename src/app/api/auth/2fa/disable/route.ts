import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { decryptSecret, verifyTotp } from '@/lib/security/totp';

/**
 * Disable authenticator (TOTP) 2FA.
 *
 * Requires the account password and a current authenticator code, so a hijacked
 * session alone cannot strip the second factor.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: { code?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const code = String(body.code ?? '').trim();
  const password = String(body.password ?? '');
  if (!code || !password) {
    return NextResponse.json(
      { success: false, error: { code: 'MISSING_FIELDS', message: 'Authenticator code and password are required' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const row = db
      .prepare('SELECT password_hash, two_factor_secret, two_factor_enabled FROM users WHERE user_id = ?')
      .get(auth.user.userId) as
      | { password_hash: string; two_factor_secret: string | null; two_factor_enabled: number }
      | undefined;

    if (!row || !row.two_factor_enabled || !row.two_factor_secret) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_ENABLED', message: '2FA is not enabled' } },
        { status: 400 },
      );
    }

    const { verifyPassword } = require('@/lib/db');
    if (!verifyPassword(password, row.password_hash)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_PASSWORD', message: 'Password is incorrect' } },
        { status: 401 },
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

    if (!verifyTotp(secret, code)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CODE', message: 'That authenticator code is not valid' } },
        { status: 400 },
      );
    }

    db.prepare(
      `UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, updated_at = datetime('now') WHERE user_id = ?`,
    ).run(auth.user.userId);

    return NextResponse.json({ success: true, data: { enabled: false } });
  } catch (error) {
    console.error('2FA disable error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
