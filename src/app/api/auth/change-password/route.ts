import { NextRequest, NextResponse } from 'next/server';
import { getDb, hashPassword, verifyPassword } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { checkPassword } from '@/lib/auth/password';
import { decryptSecret, verifyTotp } from '@/lib/security/totp';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Change the signed-in user's password.
 *
 * The current password must be supplied and verified, so a stolen session
 * alone cannot lock the owner out. When 2FA is enrolled a fresh authenticator
 * code is required as well. Every other session is revoked once the password
 * changes; the caller's own session is kept so they are not signed out mid-use.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'auth.change-password');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const currentPassword = String(body.currentPassword ?? '');
  const newPassword = String(body.newPassword ?? '');
  const totpCode = String(body.totpCode ?? '').trim();

  if (!currentPassword || !newPassword) {
    return fail('VALIDATION_FAILED', 'Current and new password are required');
  }
  if (currentPassword === newPassword) {
    return fail('VALIDATION_FAILED', 'The new password must differ from the current one');
  }

  const policy = checkPassword(newPassword);
  if (!policy.ok) {
    return fail('WEAK_PASSWORD', `Password does not meet the policy: ${policy.problems.join(', ')}`);
  }

  try {
    const db = getDb();
    const row = db
      .prepare('SELECT password_hash, two_factor_enabled, two_factor_secret FROM users WHERE user_id = ?')
      .get(auth.user.userId) as
      | { password_hash: string; two_factor_enabled: number; two_factor_secret: string | null }
      | undefined;

    if (!row) return fail('NOT_FOUND', 'User not found', 404);

    if (!verifyPassword(currentPassword, row.password_hash)) {
      return fail('INVALID_PASSWORD', 'The current password is incorrect', 401);
    }

    if (row.two_factor_enabled) {
      if (!totpCode) {
        return fail('TOTP_REQUIRED', 'Enter your authenticator code to change the password');
      }
      const secret = row.two_factor_secret ? decryptSecret(row.two_factor_secret) : '';
      if (!secret || !verifyTotp(secret, totpCode)) {
        return fail('TOTP_INVALID', 'Invalid authenticator code');
      }
    }

    const bearer = request.headers.get('authorization')?.slice(7).trim() ?? '';

    db.transaction(() => {
      db.prepare(
        `UPDATE users SET password_hash = ?, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?`,
      ).run(hashPassword(newPassword), auth.user.userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND access_token != ?').run(auth.user.userId, bearer);
    })();

    return NextResponse.json({ success: true, data: { changed: true } }, { headers: NO_STORE });
  } catch (error) {
    console.error('Change password error:', error);
    return fail('INTERNAL_ERROR', 'Password could not be changed', 500);
  }
}
