/**
 * Wallet-signature (EIP-191) authentication.
 *
 * A wallet proves control of an address by signing a single-use challenge. The
 * challenge is issued by `issueChallenge` and stored hashed with a short expiry;
 * `verifyChallenge` recovers the signer from the signature and consumes the
 * challenge so it cannot be replayed.
 *
 * Accounts are keyed by the recovered address through `social_logins` with the
 * provider id `wallet`, so one address maps to one account and the same store
 * used by the OAuth providers is reused.
 */

import { createHash, randomBytes } from 'crypto';
import { parseUtcTimestamp } from '@/lib/trading/candles';
import { verifyMessage } from 'ethers';
import { getDb, generateId } from '@/lib/db';
import { buildChallengeMessage, isChallengeFresh, normalizeAddress, sameAddress } from '@/lib/auth/wallet-signature';

/** How long a challenge stays valid. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_ID = 'wallet';

export class WalletAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'WalletAuthError';
  }
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

export interface IssuedChallenge {
  challengeId: string;
  address: string;
  message: string;
  expiresAt: string;
}

/**
 * Issue a fresh challenge for an address.
 *
 * Any earlier unconsumed challenge for the same address is invalidated so only
 * the newest nonce is accepted.
 */
export function issueChallenge(rawAddress: unknown): IssuedChallenge {
  const address = normalizeAddress(rawAddress);
  if (!address) {
    throw new WalletAuthError('INVALID_ADDRESS', 'A valid 0x wallet address is required');
  }

  const db = getDb();
  const nonce = randomBytes(24).toString('hex');
  const now = Date.now();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
  const challengeId = generateId();
  const message = buildChallengeMessage(address, nonce, now);

  db.prepare('DELETE FROM wallet_challenges WHERE address = ? AND consumed_at IS NULL').run(address);
  db.prepare(
    `INSERT INTO wallet_challenges (challenge_id, address, message, nonce_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(challengeId, address, message, hashNonce(nonce), expiresAt);

  return { challengeId, address, message, expiresAt };
}

interface ChallengeRow {
  challenge_id: string;
  address: string;
  message: string;
  nonce_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

/**
 * Verify a signed challenge and return the recovered, checksum-free address.
 *
 * The challenge is consumed before the signature is checked so a failed attempt
 * cannot be retried against the same nonce. Throws `WalletAuthError` on any
 * mismatch.
 */
export function verifyChallenge(challengeId: unknown, signature: unknown): string {
  if (typeof challengeId !== 'string' || challengeId.length === 0) {
    throw new WalletAuthError('INVALID_INPUT', 'challengeId is required');
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new WalletAuthError('INVALID_SIGNATURE', 'A hex-encoded signature is required');
  }

  const db = getDb();
  const row = db
    .prepare('SELECT * FROM wallet_challenges WHERE challenge_id = ?')
    .get(challengeId) as ChallengeRow | undefined;
  if (!row) {
    throw new WalletAuthError('UNKNOWN_CHALLENGE', 'This challenge is not recognised', 401);
  }
  if (row.consumed_at) {
    throw new WalletAuthError('CHALLENGE_USED', 'This challenge has already been used', 401);
  }

  const consumed = db
    .prepare('UPDATE wallet_challenges SET consumed_at = datetime(\'now\') WHERE challenge_id = ? AND consumed_at IS NULL')
    .run(challengeId);
  if (consumed.changes !== 1) {
    throw new WalletAuthError('CHALLENGE_USED', 'This challenge has already been used', 401);
  }

  const createdAtMs = parseUtcTimestamp(row.created_at);
  if (!isChallengeFresh(createdAtMs, Date.now(), CHALLENGE_TTL_MS + 60_000)) {
    throw new WalletAuthError('CHALLENGE_EXPIRED', 'This challenge has expired', 401);
  }

  // The message is the exact one that was issued, stored alongside the
  // challenge. Because the nonce is unique and single-use, a signature over any
  // other message recovers a different address.
  const message = row.message;

  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    throw new WalletAuthError('INVALID_SIGNATURE', 'The signature could not be verified', 401);
  }

  if (!sameAddress(recovered, row.address)) {
    throw new WalletAuthError('SIGNATURE_MISMATCH', 'The signature does not match the challenge address', 401);
  }

  return normalizeAddress(recovered) as string;
}

export interface WalletSession {
  userId: string;
  address: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Resolve or create the account for a verified address and open a session.
 *
 * `create` distinguishes registration (a new address is allowed) from login (an
 * unknown address is rejected). When an email is supplied at registration it is
 * attached to the new account.
 */
export function openWalletSession(
  address: string,
  options: { create: boolean; email?: string | null; ip?: string | null; userAgent?: string | null },
): WalletSession {
  const db = getDb();
  const normalized = normalizeAddress(address);
  if (!normalized) throw new WalletAuthError('INVALID_ADDRESS', 'A valid wallet address is required');

  const link = db
    .prepare('SELECT user_id FROM social_logins WHERE provider = ? AND provider_user_id = ?')
    .get(PROVIDER_ID, normalized) as { user_id: string } | undefined;

  let userId = link?.user_id ?? null;
  if (!userId) {
    if (!options.create) {
      throw new WalletAuthError('ACCOUNT_NOT_FOUND', 'No account is linked to this wallet', 404);
    }
    const email = typeof options.email === 'string' && options.email.trim().length > 0
      ? options.email.trim().toLowerCase()
      : null;
    if (email) {
      const taken = db.prepare('SELECT user_id FROM users WHERE email = ?').get(email) as
        | { user_id: string }
        | undefined;
      if (taken) {
        throw new WalletAuthError('EMAIL_IN_USE', 'An account already exists for this email', 409);
      }
    }

    userId = generateId();
    db.prepare(
      `INSERT INTO users (user_id, email, password_hash, email_verified, status, created_at, updated_at)
       VALUES (?, ?, ?, 0, 'active', datetime('now'), datetime('now'))`,
    ).run(userId, email ?? `${normalized}@wallet.local`, `wallet:${normalized}`);

    db.prepare(
      `INSERT INTO social_logins (social_id, user_id, provider, provider_user_id, email)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(generateId(), userId, PROVIDER_ID, normalized, email);
  }

  const accessToken = randomBytes(32).toString('hex');
  const refreshToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO sessions (session_id, user_id, access_token, refresh_token, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(generateId(), userId, accessToken, refreshToken, expiresAt, options.ip ?? 'unknown', options.userAgent ?? 'unknown');

  return { userId, address: normalized, accessToken, refreshToken, expiresAt };
}
