'use strict';
/**
 * Account security, VIP tier and fee-schedule tests against a real database.
 *
 * These cover the rules the API layer relies on: a security flag round-trips
 * through the account's own columns, a session cannot revoke itself, an API
 * secret is returned once and stored only as a hash plus an encrypted copy, and
 * a VIP tier is granted only when both the volume and holding requirements are
 * met.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-account-')), 'account.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const {
  securitySettings,
  updateSecuritySettings,
  loginHistory,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  listApiKeys,
  createApiKey,
  revokeApiKey,
  verifyApiSecret,
  AccountError,
} = require('../../.test-build/account.js');
const { vipLevels, vipInfo } = require('../../.test-build/vip.js');
const { feeConfigs } = require('../../.test-build/fee-schedule.js');
const { creditAvailable } = require('../../.test-build/ledger.js');

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

function seedSession(userId, token) {
  const sessionId = generateId();
  db.prepare(
    `INSERT INTO sessions (session_id, user_id, access_token, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+1 day'))`,
  ).run(sessionId, userId, token, 'test-agent', '203.0.113.10');
  return sessionId;
}

test('a security flag round-trips through the account columns', () => {
  const userId = seedUser();
  const before = securitySettings(userId);
  assert.equal(before.two_factor_enabled, false);
  assert.equal(before.login_alerts_enabled, false);

  const after = updateSecuritySettings(userId, { login_alerts_enabled: true });
  assert.equal(after.login_alerts_enabled, true);
  assert.equal(after.two_factor_enabled, false, 'an unrelated flag must not change');

  // Re-read through a fresh query, not the returned object.
  assert.equal(securitySettings(userId).login_alerts_enabled, true);
});

test('a non-boolean flag is rejected rather than coerced', () => {
  const userId = seedUser();
  assert.throws(
    () => updateSecuritySettings(userId, { login_alerts_enabled: 'yes' }),
    (error) => error instanceof AccountError && error.code === 'VALIDATION_FAILED',
  );
});

test('the 2FA flag cannot be flipped from the settings endpoint', () => {
  const userId = seedUser();
  // A session token alone must not be able to strip the second factor; the
  // dedicated endpoint verifies a password and a live code instead.
  assert.throws(
    () => updateSecuritySettings(userId, { two_factor_enabled: false }),
    (error) => error instanceof AccountError && error.code === 'TWO_FACTOR_REQUIRES_VERIFICATION',
  );
  assert.throws(
    () => updateSecuritySettings(userId, { two_factor_enabled: true }),
    (error) => error instanceof AccountError && error.code === 'TWO_FACTOR_REQUIRES_VERIFICATION',
  );
  // The refusal is total: a request that also names a valid flag changes nothing.
  assert.throws(
    () => updateSecuritySettings(userId, { two_factor_enabled: true, login_alerts_enabled: true }),
    (error) => error.code === 'TWO_FACTOR_REQUIRES_VERIFICATION',
  );
  assert.equal(securitySettings(userId).login_alerts_enabled, false);
});

test('an anti-phishing code can be set and cleared', () => {
  const userId = seedUser();
  assert.equal(updateSecuritySettings(userId, { anti_phishing_code: 'tiger-42' }).anti_phishing_code, 'tiger-42');
  assert.equal(updateSecuritySettings(userId, { anti_phishing_code: '' }).anti_phishing_code, null);
});

test('updating an unknown account fails closed', () => {
  assert.throws(
    () => updateSecuritySettings('00000000-0000-0000-0000-000000000000', { login_alerts_enabled: true }),
    (error) => error instanceof AccountError && error.code === 'NOT_FOUND',
  );
});

test('the login history reports failed and successful attempts newest first', () => {
  const userId = seedUser();
  db.prepare(
    `INSERT INTO login_attempts (attempt_id, user_id, ip_address, success, failure_reason, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-2 minutes'))`,
  ).run(generateId(), userId, '203.0.113.1', 0, 'bad password');
  db.prepare(
    `INSERT INTO login_attempts (attempt_id, user_id, ip_address, success, failure_reason, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(generateId(), userId, '203.0.113.2', 1, null);

  const history = loginHistory(userId);
  assert.equal(history.length, 2);
  assert.equal(history[0].success, true, 'the newest attempt is first');
  assert.equal(history[1].failure_reason, 'bad password');
});

test('the caller cannot revoke the session they are using', () => {
  const userId = seedUser();
  const token = 'token-current';
  const currentId = seedSession(userId, token);
  const otherId = seedSession(userId, 'token-other');

  const sessions = listSessions(userId, token);
  assert.equal(sessions.find((s) => s.id === currentId)?.current, true);
  assert.equal(sessions.find((s) => s.id === otherId)?.current, false);

  assert.throws(
    () => revokeSession(userId, currentId, token),
    (error) => error instanceof AccountError && error.code === 'CANNOT_REVOKE_CURRENT',
  );

  revokeSession(userId, otherId, token);
  assert.equal(listSessions(userId, token).length, 1, 'only the other session is gone');
});

test('signing out other devices keeps the caller signed in', () => {
  const userId = seedUser();
  const token = 'token-keep';
  seedSession(userId, token);
  seedSession(userId, 'token-a');
  seedSession(userId, 'token-b');

  const revoked = revokeOtherSessions(userId, token);
  assert.equal(revoked, 2);
  const remaining = listSessions(userId, token);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].current, true);
});

test('an API secret is returned once, hashed at rest, and verifiable', () => {
  const userId = seedUser();
  const created = createApiKey(userId, 'bot-key', ['read', 'trade']);

  assert.ok(created.apiSecret.length >= 32);
  assert.equal(created.apiKey, `tgx_${created.id}`);

  const stored = db.prepare('SELECT key_hash FROM api_keys WHERE key_id = ?').get(created.id);
  assert.ok(!stored.key_hash.includes(created.apiSecret), 'the plaintext secret must not be stored');

  const listed = listApiKeys(userId);
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].permissions, ['read', 'trade']);
  assert.equal(Object.prototype.hasOwnProperty.call(listed[0], 'apiSecret'), false);
  assert.equal(JSON.stringify(listed).includes(created.apiSecret), false, 'the list must not leak the secret');

  assert.equal(verifyApiSecret(userId, created.id, created.apiSecret), true);
  assert.equal(verifyApiSecret(userId, created.id, 'not-the-secret'), false);
});

test('an API key with an unknown permission is rejected', () => {
  const userId = seedUser();
  assert.throws(
    () => createApiKey(userId, 'bad-key', ['read', 'admin']),
    (error) => error instanceof AccountError && error.code === 'VALIDATION_FAILED',
  );
});

test('an API key with no permission is rejected', () => {
  const userId = seedUser();
  assert.throws(
    () => createApiKey(userId, 'empty-key', []),
    (error) => error instanceof AccountError && error.code === 'VALIDATION_FAILED',
  );
});

test('one account cannot revoke another account key', () => {
  const owner = seedUser();
  const stranger = seedUser();
  const created = createApiKey(owner, 'owner-key', ['read']);

  assert.throws(
    () => revokeApiKey(stranger, created.id),
    (error) => error instanceof AccountError && error.code === 'NOT_FOUND',
  );
  assert.equal(listApiKeys(owner).length, 1, 'the owner still has the key');

  revokeApiKey(owner, created.id);
  assert.equal(listApiKeys(owner).length, 0);
});

test('the VIP ladder is published from the fee schedule', () => {
  const levels = vipLevels();
  assert.ok(levels.length >= 2, 'the seeded schedule has several tiers');
  for (const level of levels) {
    assert.ok(level.maker_fee >= 0 && level.maker_fee < 1);
    assert.ok(level.taker_fee >= 0 && level.taker_fee < 1);
  }
  // VIP 0 is the baseline: 10 bps maker and taker.
  const base = levels.find((level) => level.level === 0);
  assert.equal(base.spot_maker_fee, 0.001);
});

test('a tier is granted only when volume and holding both qualify', () => {
  const userId = seedUser();
  const info = vipInfo(userId);
  assert.equal(info.current_level, 0, 'a new account with no volume is VIP 0');
  assert.equal(info.trading_volume, 0);
  assert.ok(info.next_level !== null);
  assert.equal(info.volume_to_next, info.next_level_requirement);
});

test('a large TGR holding without volume cannot claim a rebate tier', () => {
  const userId = seedUser();
  creditAvailable(userId, 'TGR', 5_000_000);

  const info = vipInfo(userId);
  assert.equal(info.current_level, 0, 'holding alone must not grant a volume tier');
  assert.equal(info.tgr_holding, 5_000_000);
});

test('settled volume and holding together advance the tier', () => {
  const userId = seedUser();
  creditAvailable(userId, 'TGR', 1_000_000);

  // 30-day volume is summed from settled trades, so insert a large one.
  db.prepare(
    `INSERT INTO spot_trades (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id,
                              taker_user_id, side, price, quantity, quote_quantity, maker_fee, taker_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    'BTC/RUSD',
    generateId(),
    generateId(),
    userId,
    generateId(),
    'buy',
    50000,
    200,
    10_000_000,
    0,
    0,
  );

  const info = vipInfo(userId);
  assert.ok(info.current_level > 0, 'volume plus holding should advance the tier');
  assert.equal(info.trading_volume, 10_000_000);
});

test('the published fee schedule includes trading fees and never invents a network fee', () => {
  const configs = feeConfigs();
  const trade = configs.filter((config) => config.type === 'trade');
  assert.ok(trade.length >= 4, 'each tier publishes maker and taker for spot and futures');
  for (const config of trade) {
    assert.equal(config.fee_type, 'percentage');
    assert.ok(config.fee_amount >= 0 && config.fee_amount < 1);
  }
  // No withdrawal policy is configured in this database, so no withdrawal fee
  // may appear. A fabricated fee would let a client quote an unhonoured price.
  assert.equal(configs.some((config) => config.type === 'withdraw'), false);
});
