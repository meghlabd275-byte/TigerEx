'use strict';
/**
 * Tests for the public API-key gateway (`/api/v1`).
 *
 * A request is signed with the secret shown once at key creation. These tests
 * assert the rejections an attacker would attempt: a forged signature, a
 * replayed old timestamp, a key without the needed permission, a key called
 * from an address outside its whitelist.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-apiv1-')), 'apiv1.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { createApiKey } = require('../../.test-build/account.js');
const {
  signRequest,
  signatureBase,
  authenticateApiRequest,
  ApiAuthError,
  MAX_CLOCK_SKEW_MS,
} = require('../../.test-build/api-auth.js');

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

const NOW = 1_700_000_000_000;
const PATH = '/api/v1/balance';

test('the canonical string hashes the body and joins the request parts', () => {
  const base = signatureBase('get', PATH, '123', '{"a":1}');
  const [method, signedPath, timestamp, bodyHash] = base.split('\n');
  assert.equal(method, 'GET');
  assert.equal(signedPath, PATH);
  assert.equal(timestamp, '123');
  assert.match(bodyHash, /^[0-9a-f]{64}$/);
});

test('a correctly signed request is accepted', () => {
  const user = seedUser();
  const key = createApiKey(user, 'reader', ['read']);
  const signature = signRequest(key.apiSecret, 'GET', PATH, String(NOW), '');

  const result = authenticateApiRequest(
    { apiKey: key.apiKey, timestamp: String(NOW), signature },
    'GET',
    PATH,
    '',
    'read',
    null,
    NOW,
  );
  assert.equal(result.userId, user);
  assert.equal(result.keyId, key.id);
  assert.deepEqual(result.permissions, ['read']);

  const stamped = db.prepare('SELECT last_used_at FROM api_keys WHERE key_id = ?').get(key.id);
  assert.ok(stamped.last_used_at);
});

test('a forged signature is rejected', () => {
  const user = seedUser();
  const key = createApiKey(user, 'reader', ['read']);
  const good = signRequest(key.apiSecret, 'GET', PATH, String(NOW), '');
  const forged = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');

  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: key.apiKey, timestamp: String(NOW), signature: forged },
        'GET',
        PATH,
        '',
        'read',
        null,
        NOW,
      ),
    (error) => error instanceof ApiAuthError && error.code === 'SIGNATURE_INVALID',
  );
});

test('a signature over a different body or path is rejected', () => {
  const user = seedUser();
  const key = createApiKey(user, 'trader', ['read', 'trade']);
  const signature = signRequest(key.apiSecret, 'POST', '/api/v1/order', String(NOW), '{"quantity":1}');

  // Same signature presented for a different body.
  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: key.apiKey, timestamp: String(NOW), signature },
        'POST',
        '/api/v1/order',
        '{"quantity":1000000}',
        'trade',
        null,
        NOW,
      ),
    (error) => error.code === 'SIGNATURE_INVALID',
  );
  // Same signature presented for a different path.
  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: key.apiKey, timestamp: String(NOW), signature },
        'POST',
        '/api/v1/withdraw',
        '{"quantity":1}',
        'trade',
        null,
        NOW,
      ),
    (error) => error.code === 'SIGNATURE_INVALID',
  );
});

test('a timestamp outside the allowed skew is rejected', () => {
  const user = seedUser();
  const key = createApiKey(user, 'reader', ['read']);
  const old = NOW - MAX_CLOCK_SKEW_MS - 1;
  const signature = signRequest(key.apiSecret, 'GET', PATH, String(old), '');

  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: key.apiKey, timestamp: String(old), signature },
        'GET',
        PATH,
        '',
        'read',
        null,
        NOW,
      ),
    (error) => error.code === 'TIMESTAMP_OUT_OF_RANGE',
  );
});

test('a key without the required permission is rejected', () => {
  const user = seedUser();
  const key = createApiKey(user, 'reader-only', ['read']);
  const signature = signRequest(key.apiSecret, 'POST', '/api/v1/order', String(NOW), '{}');

  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: key.apiKey, timestamp: String(NOW), signature },
        'POST',
        '/api/v1/order',
        '{}',
        'trade',
        null,
        NOW,
      ),
    (error) => error.code === 'PERMISSION_DENIED' && error.status === 403,
  );
});

test('an address outside the key whitelist is rejected, an allowed one passes', () => {
  const user = seedUser();
  const key = createApiKey(user, 'scoped', ['read'], ['203.0.113.7']);
  const signature = signRequest(key.apiSecret, 'GET', PATH, String(NOW), '');

  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: key.apiKey, timestamp: String(NOW), signature },
        'GET',
        PATH,
        '',
        'read',
        '198.51.100.1',
        NOW,
      ),
    (error) => error.code === 'IP_NOT_ALLOWED',
  );

  const allowed = authenticateApiRequest(
    { apiKey: key.apiKey, timestamp: String(NOW), signature },
    'GET',
    PATH,
    '',
    'read',
    '203.0.113.7',
    NOW,
  );
  assert.equal(allowed.userId, user);
});

test('an unknown or malformed key is rejected', () => {
  const user = seedUser();
  const key = createApiKey(user, 'reader', ['read']);
  const signature = signRequest(key.apiSecret, 'GET', PATH, String(NOW), '');

  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: 'tgx_does-not-exist', timestamp: String(NOW), signature },
        'GET',
        PATH,
        '',
        'read',
        null,
        NOW,
      ),
    (error) => error.code === 'UNAUTHORIZED',
  );

  assert.throws(
    () => authenticateApiRequest({ apiKey: '', timestamp: '', signature: '' }, 'GET', PATH, '', 'read', null, NOW),
    (error) => error.code === 'UNAUTHORIZED',
  );
});

test('a revoked key is rejected', () => {
  const user = seedUser();
  const key = createApiKey(user, 'temp', ['read']);
  const signature = signRequest(key.apiSecret, 'GET', PATH, String(NOW), '');
  db.prepare('UPDATE api_keys SET enabled = 0 WHERE key_id = ?').run(key.id);

  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: key.apiKey, timestamp: String(NOW), signature },
        'GET',
        PATH,
        '',
        'read',
        null,
        NOW,
      ),
    (error) => error.code === 'UNAUTHORIZED',
  );
});

test('an expired key is rejected', () => {
  const user = seedUser();
  const key = createApiKey(user, 'expiring', ['read']);
  const realNow = Date.now();
  const timestamp = String(realNow);
  const signature = signRequest(key.apiSecret, 'GET', PATH, timestamp, '');
  db.prepare("UPDATE api_keys SET expires_at = datetime('now', '-1 day') WHERE key_id = ?").run(key.id);

  assert.throws(
    () =>
      authenticateApiRequest(
        { apiKey: key.apiKey, timestamp, signature },
        'GET',
        PATH,
        '',
        'read',
        null,
        realNow,
      ),
    (error) => error.code === 'UNAUTHORIZED',
  );
});
