/**
 * Session token rotation and account-status rules.
 *
 * Free of `next/server` so the rules can be exercised by the logic test
 * runner. `issueSession` (which needs request headers) lives in
 * `session-issue.ts` and delegates its status check here.
 */

import { randomBytes } from 'crypto';
import { getDb } from '@/lib/db';

export class SessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 403,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export class RefreshError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = 'RefreshError';
  }
}

/**
 * Assert that an account may hold a session.
 *
 * A missing account and an account that is not active are both refused, so no
 * issuance path (password, wallet, social, OTP) can hand a suspended user a
 * working token.
 */
export function assertAccountActive(userId: string): void {
  const account = getDb().prepare('SELECT status FROM users WHERE user_id = ?').get(userId) as
    | { status: string | null }
    | undefined;
  if (!account) throw new SessionError('UNKNOWN_ACCOUNT', 'The account no longer exists', 404);
  if (account.status && account.status !== 'active') {
    throw new SessionError('ACCOUNT_INACTIVE', 'This account is not active', 403);
  }
}

export interface RotatedTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Rotate the tokens of the session identified by a refresh token.
 *
 * The refresh token must belong to a session that has not expired and whose
 * account is active. Both tokens are replaced, so a stolen refresh token is
 * usable at most once. Any failure is explicit; there is no silent fallback.
 */
export function rotateSession(refreshToken: string): RotatedTokens {
  const db = getDb();
  const session = db
    .prepare(
      `SELECT s.session_id, s.user_id, u.status
         FROM sessions s
         JOIN users u ON s.user_id = u.user_id
        WHERE s.refresh_token = ? AND datetime(s.expires_at) > datetime('now')`,
    )
    .get(refreshToken) as { session_id: string; user_id: string; status: string | null } | undefined;

  if (!session) throw new RefreshError('INVALID_TOKEN', 'Invalid or expired refresh token', 401);
  if (session.status && session.status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(session.user_id);
    throw new RefreshError('ACCOUNT_INACTIVE', 'This account is not active', 403);
  }

  const accessToken = randomBytes(32).toString('hex');
  const nextRefreshToken = randomBytes(32).toString('hex');
  db.prepare(
    `UPDATE sessions
        SET access_token = ?, refresh_token = ?, last_active_at = datetime('now')
      WHERE session_id = ?`,
  ).run(accessToken, nextRefreshToken, session.session_id);

  return { accessToken, refreshToken: nextRefreshToken };
}
