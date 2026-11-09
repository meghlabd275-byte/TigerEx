'use strict';
/**
 * Pending second-factor challenge tests.
 *
 * The login route used to store its temporary 2FA token as an ordinary row in
 * `sessions`. Because `requireSession` accepts any row in `sessions`, that token
 * doubled as a full bearer credential: a password-only attacker could skip the
 * second factor for the ten minutes it lived. These tests assert the challenge
 * is now a separate, single-use, expiring record that is not a session.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-challenge-')), 'challenge.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const {
  createLoginChallenge,
  requireLoginChallenge,
  recordChallengeFailure,
  consumeChallenge,
  ChallengeError,
} = require('../../.test-build/login-challenge.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare('INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, ?)').run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
    'active',
  );
  return userId;
}

test('a challenge token is not a session and cannot authenticate', () => {
  const userId = seedUser();
  const { token } = createLoginChallenge(userId);

  // The token must not appear in the sessions table at all.
  const asSession = db.prepare('SELECT 1 FROM sessions WHERE access_token = ?').get(token);
  assert.equal(asSession, undefined, 'challenge token must never be a session');

  const row = db.prepare('SELECT token_hash FROM login_challenges WHERE user_id = ?').get(userId);
  assert.ok(row, 'challenge is stored');
  assert.notEqual(row.token_hash, token, 'the raw token is not stored, only its digest');
});

test('a valid challenge resolves to its account', () => {
  const userId = seedUser();
  const { token } = createLoginChallenge(userId);
  const challenge = requireLoginChallenge(token);
  assert.equal(challenge.userId, userId);
});

test('an unknown challenge token is refused', () => {
  assert.throws(
    () => requireLoginChallenge('deadbeef'),
    (error) => error instanceof ChallengeError && error.code === 'INVALID_CHALLENGE',
  );
});

test('an expired challenge is refused', () => {
  const userId = seedUser();
  const { token } = createLoginChallenge(userId);
  db.prepare('UPDATE login_challenges SET expires_at = ? WHERE user_id = ?').run(
    new Date(Date.now() - 60_000).toISOString(),
    userId,
  );
  assert.throws(
    () => requireLoginChallenge(token),
    (error) => error instanceof ChallengeError && error.code === 'CHALLENGE_EXPIRED',
  );
});

test('a challenge is consumed once and cannot be reused', () => {
  const userId = seedUser();
  const { token } = createLoginChallenge(userId);
  const challenge = requireLoginChallenge(token);
  consumeChallenge(challenge.challengeId);
  assert.throws(
    () => requireLoginChallenge(token),
    (error) => error instanceof ChallengeError && error.code === 'INVALID_CHALLENGE',
  );
});

test('repeated failures lock the challenge', () => {
  const userId = seedUser();
  const { token } = createLoginChallenge(userId);
  const challenge = requireLoginChallenge(token);
  for (let i = 0; i < 5; i += 1) recordChallengeFailure(challenge.challengeId);
  assert.throws(
    () => requireLoginChallenge(token),
    (error) => error instanceof ChallengeError && error.code === 'CHALLENGE_LOCKED',
  );
});

test('issuing a new challenge invalidates the previous one', () => {
  const userId = seedUser();
  const first = createLoginChallenge(userId);
  const second = createLoginChallenge(userId);
  assert.throws(
    () => requireLoginChallenge(first.token),
    (error) => error instanceof ChallengeError && error.code === 'INVALID_CHALLENGE',
  );
  assert.equal(requireLoginChallenge(second.token).userId, userId);
});
