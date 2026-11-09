'use strict';
/**
 * Session rotation and account-status tests.
 *
 * These exercise the real database helpers: a refresh token rotates exactly
 * once, an unknown or expired token is refused, and a suspended account can
 * neither receive a session nor refresh one. The point is that the rules are
 * fail-closed — the previous behaviour issued a session to any account,
 * regardless of its status, and had no working refresh path at all.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-session-')), 'session.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const {
  assertAccountActive,
  rotateSession,
  SessionError,
  RefreshError,
} = require('../../.test-build/session-rotate.js');

const db = getDb();

function seedUser(status = 'active') {
  const userId = generateId();
  db.prepare('INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, ?)').run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
    status,
  );
  return userId;
}

function seedSession(userId, refreshToken, expiresAt) {
  db.prepare(
    `INSERT INTO sessions (session_id, user_id, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(generateId(), userId, generateId(), refreshToken, expiresAt);
}

test('an active account may hold a session', () => {
  const userId = seedUser('active');
  assert.doesNotThrow(() => assertAccountActive(userId));
});

test('a suspended account may not hold a session', () => {
  const userId = seedUser('suspended');
  assert.throws(
    () => assertAccountActive(userId),
    (error) => error instanceof SessionError && error.code === 'ACCOUNT_INACTIVE' && error.status === 403,
  );
});

test('an unknown account is refused with a 404', () => {
  assert.throws(
    () => assertAccountActive('does-not-exist'),
    (error) => error instanceof SessionError && error.code === 'UNKNOWN_ACCOUNT' && error.status === 404,
  );
});

test('a refresh token rotates exactly once', () => {
  const userId = seedUser();
  const refreshToken = 'refresh-token-original';
  seedSession(userId, refreshToken, new Date(Date.now() + 3600_000).toISOString());

  const rotated = rotateSession(refreshToken);
  assert.ok(rotated.accessToken && rotated.refreshToken);
  assert.notEqual(rotated.refreshToken, refreshToken);

  // The old token no longer works; the new one does.
  assert.throws(
    () => rotateSession(refreshToken),
    (error) => error instanceof RefreshError && error.code === 'INVALID_TOKEN',
  );
  const second = rotateSession(rotated.refreshToken);
  assert.notEqual(second.accessToken, rotated.accessToken);
});

test('an expired refresh token is refused', () => {
  const userId = seedUser();
  seedSession(userId, 'expired-token', new Date(Date.now() - 1000).toISOString());
  assert.throws(
    () => rotateSession('expired-token'),
    (error) => error instanceof RefreshError && error.code === 'INVALID_TOKEN',
  );
});

test('a suspended account cannot refresh and its sessions are dropped', () => {
  const userId = seedUser('suspended');
  seedSession(userId, 'suspended-token', new Date(Date.now() + 3600_000).toISOString());

  assert.throws(
    () => rotateSession('suspended-token'),
    (error) => error instanceof RefreshError && error.code === 'ACCOUNT_INACTIVE' && error.status === 403,
  );

  const remaining = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId);
  assert.equal(remaining.n, 0);
});
