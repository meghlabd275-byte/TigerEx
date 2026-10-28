import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { getDb, generateId } from '@/lib/db';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: Record<string, unknown>;
}

/** Create a durable session row and return the tokens for the client. */
export function issueSession(
  request: NextRequest,
  userId: string,
  options: { trustedDevice?: boolean } = {},
): IssuedSession {
  const db = getDb();
  const accessToken = randomBytes(32).toString('hex');
  const refreshToken = randomBytes(32).toString('hex');
  const ttlMs = options.trustedDevice ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  db.prepare(
    `INSERT INTO sessions (session_id, user_id, access_token, refresh_token, expires_at, ip_address, user_agent, trusted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    userId,
    accessToken,
    refreshToken,
    expiresAt,
    request.headers.get('x-forwarded-for') || 'unknown',
    request.headers.get('user-agent') || 'unknown',
    options.trustedDevice ? 1 : 0,
  );

  db.prepare(
    `UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?`,
  ).run(userId);

  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as Record<string, unknown>;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    user: {
      userId: user.user_id,
      email: user.email,
      phone: user.phone,
      username: user.username,
      kycLevel: user.kyc_level,
      kycStatus: user.kyc_status,
      twoFactorEnabled: !!user.two_factor_enabled,
    },
  };
}
