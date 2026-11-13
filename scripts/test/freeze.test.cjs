'use strict';
/**
 * Withdrawal security-hold tests against a real database.
 *
 * A hold placed after a security-sensitive change must block a withdrawal until
 * it lifts, and an expired hold must not block one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-freeze-')), 'freeze.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { placeWithdrawalHold, withdrawalHoldStatus, clearWithdrawalHold } = require('../../.test-build/freeze.js');

function makeUser() {
  const userId = generateId();
  getDb()
    .prepare('INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, ?)')
    .run(userId, `${userId}@example.test`, hashPassword('pw'), 'active');
  return userId;
}

test('an account with no hold is not held', () => {
  const userId = makeUser();
  const status = withdrawalHoldStatus(userId);
  assert.equal(status.held, false);
  assert.equal(status.until, null);
});

test('a hold blocks a withdrawal until it lifts', () => {
  const userId = makeUser();
  placeWithdrawalHold(userId, 'password changed');
  const status = withdrawalHoldStatus(userId);
  assert.equal(status.held, true);
  assert.ok(status.hoursRemaining >= 1 && status.hoursRemaining <= 48);
  assert.equal(status.reason, 'password changed');
});

test('an expired hold does not block a withdrawal', () => {
  const userId = makeUser();
  // A hold placed one second ago for zero hours is already in the past.
  getDb().prepare("UPDATE users SET withdrawal_hold_until = datetime('now','-1 hour'), withdrawal_hold_reason = 'old' WHERE user_id = ?").run(userId);
  assert.equal(withdrawalHoldStatus(userId).held, false);
});

test('an operator can lift a hold early', () => {
  const userId = makeUser();
  placeWithdrawalHold(userId, 'new device');
  assert.equal(withdrawalHoldStatus(userId).held, true);
  clearWithdrawalHold(userId);
  assert.equal(withdrawalHoldStatus(userId).held, false);
});
