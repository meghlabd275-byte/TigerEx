import { createHash, randomBytes } from 'crypto';
import { getDb, generateId } from '@/lib/db';

/**
 * Pending second-factor login challenges.
 *
 * When a password is correct but the account has a second factor enabled, the
 * login route hands the client an opaque token to complete verification with.
 * That token must not be a session: a session row is accepted by
 * `requireSession`, so storing the token there would let a password-only
 * attacker use it as a full bearer credential and skip the second factor.
 *
 * A challenge is therefore kept in its own table, only the SHA-256 digest is
 * stored, it is single-use, it expires quickly, and it grants no session until
 * a second factor is verified.
 */

export class ChallengeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ChallengeError';
    this.code = code;
    this.status = status;
  }
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedChallenge {
  token: string;
  expiresAt: string;
}

/** Issue a fresh pending-2FA challenge for an account, replacing any prior one. */
export function createLoginChallenge(userId: string): CreatedChallenge {
  const db = getDb();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  // One outstanding challenge per account: a second password step invalidates
  // the first token so an old token cannot be replayed.
  db.prepare('DELETE FROM login_challenges WHERE user_id = ?').run(userId);
  db.prepare(
    `INSERT INTO login_challenges (challenge_id, user_id, token_hash, expires_at, attempts, max_attempts)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(generateId(), userId, digestToken(token), expiresAt, MAX_ATTEMPTS);

  return { token, expiresAt };
}

export interface PendingChallenge {
  challengeId: string;
  userId: string;
}

/**
 * Look up a pending challenge by its token.
 *
 * Throws a typed `ChallengeError` when the token is unknown, expired or has
 * exhausted its attempts. The challenge is not consumed here: the caller
 * verifies the second factor first, then calls `consumeChallenge`.
 */
export function requireLoginChallenge(token: string): PendingChallenge {
  if (!token) {
    throw new ChallengeError('INVALID_CHALLENGE', 'Sign in again to continue', 400);
  }
  const db = getDb();
  const row = db
    .prepare(
      'SELECT challenge_id, user_id, attempts, max_attempts, expires_at FROM login_challenges WHERE token_hash = ?',
    )
    .get(digestToken(token)) as
    | { challenge_id: string; user_id: string; attempts: number; max_attempts: number; expires_at: string }
    | undefined;

  if (!row) {
    throw new ChallengeError('INVALID_CHALLENGE', 'Sign in again to continue', 400);
  }
  if (row.attempts >= row.max_attempts) {
    db.prepare('DELETE FROM login_challenges WHERE challenge_id = ?').run(row.challenge_id);
    throw new ChallengeError('CHALLENGE_LOCKED', 'Too many attempts. Sign in again.', 429);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM login_challenges WHERE challenge_id = ?').run(row.challenge_id);
    throw new ChallengeError('CHALLENGE_EXPIRED', 'Login session has expired. Sign in again.', 400);
  }

  return { challengeId: row.challenge_id, userId: row.user_id };
}

/** Count a failed second-factor attempt so the token cannot be brute-forced. */
export function recordChallengeFailure(challengeId: string): void {
  getDb()
    .prepare('UPDATE login_challenges SET attempts = attempts + 1 WHERE challenge_id = ?')
    .run(challengeId);
}

/** Consume a challenge once its second factor has been verified. */
export function consumeChallenge(challengeId: string): void {
  getDb().prepare('DELETE FROM login_challenges WHERE challenge_id = ?').run(challengeId);
}
