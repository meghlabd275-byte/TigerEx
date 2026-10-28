import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import {
  buildOtpauthUrl,
  encryptSecret,
  generateTotpSecret,
  renderQrDataUrl,
  verifyTotp,
  decryptSecret,
} from '@/lib/security/totp';

/**
 * Begin or confirm authenticator (TOTP) enrolment.
 *
 * Step 1 (no `code`): issue a fresh secret, store it encrypted but leave 2FA
 * disabled, and return the secret plus a QR code once so the user can add it to
 * their authenticator app.
 *
 * Step 2 (`code` present): verify the submitted code against the pending
 * secret. Only a correct code flips `two_factor_enabled`, so 2FA can never be
 * reported as on before the user has proven possession of the secret.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: { code?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const code = body.code === undefined ? '' : String(body.code).trim();
  const db = getDb();

  try {
    const row = db
      .prepare('SELECT email, two_factor_secret, two_factor_enabled FROM users WHERE user_id = ?')
      .get(auth.user.userId) as
      | { email: string; two_factor_secret: string | null; two_factor_enabled: number }
      | undefined;
    if (!row) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 },
      );
    }

    if (!code) {
      if (row.two_factor_enabled) {
        return NextResponse.json(
          { success: false, error: { code: 'ALREADY_ENABLED', message: '2FA is already enabled. Disable it before re-enrolling.' } },
          { status: 409 },
        );
      }
      const secret = generateTotpSecret();
      db.prepare(
        `UPDATE users SET two_factor_secret = ?, two_factor_type = 'totp', updated_at = datetime('now') WHERE user_id = ?`,
      ).run(encryptSecret(secret), auth.user.userId);

      const otpauthUrl = buildOtpauthUrl(secret, row.email);
      const qrDataUrl = await renderQrDataUrl(otpauthUrl);
      return NextResponse.json(
        { success: true, data: { secret, otpauthUrl, qrDataUrl } },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (!row.two_factor_secret) {
      return NextResponse.json(
        { success: false, error: { code: 'NO_PENDING_SECRET', message: 'Start enrolment before submitting a code' } },
        { status: 400 },
      );
    }

    let secret: string;
    try {
      secret = decryptSecret(row.two_factor_secret);
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'SECRET_UNREADABLE', message: 'Stored secret could not be read; restart enrolment' } },
        { status: 500 },
      );
    }

    if (!verifyTotp(secret, code)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CODE', message: 'That code is not valid. Check your authenticator clock and try again.' } },
        { status: 400 },
      );
    }

    db.prepare(
      `UPDATE users SET two_factor_enabled = 1, two_factor_type = 'totp', updated_at = datetime('now') WHERE user_id = ?`,
    ).run(auth.user.userId);

    return NextResponse.json({ success: true, data: { enabled: true } });
  } catch (error) {
    console.error('2FA enable error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
