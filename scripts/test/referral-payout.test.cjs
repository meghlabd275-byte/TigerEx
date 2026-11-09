'use strict';
/**
 * Referral commission payout tests against a real database.
 *
 * A referred trade records a commission as `pending`; this suite proves the
 * payout draws from the funded `referral_rewards` pool rather than minting,
 * credits the referrer exactly once, and fails closed when the pool is short.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-referral-')), 'referral.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance } = require('../../.test-build/ledger.js');
const {
  recordReferredTrade,
  payoutReferralCommissions,
  fundReferralPool,
  referralPoolBalance,
} = require('../../.test-build/referral.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, 'active')`).run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
  );
  return userId;
}

/** Link a referee to a referrer so referred trades accrue a commission. */
function linkReferral(referrerId, refereeId) {
  db.prepare(
    `INSERT INTO referrals (referral_id, referrer_id, referee_id, referral_code, status, tier)
     VALUES (?, ?, ?, 'REFCODE', 'pending', 'Bronze')`,
  ).run(generateId(), referrerId, refereeId);
}

function pendingCommissions(referrerId) {
  return db
    .prepare("SELECT status, amount FROM referral_commissions WHERE referrer_id = ? ORDER BY created_at")
    .all(referrerId);
}

/** Insert a commission directly so a test can pick its own asset. */
function insertCommission(referrerId, refereeId, amount, currency) {
  const referralId = generateId();
  db.prepare(
    `INSERT INTO referrals (referral_id, referrer_id, referee_id, referral_code, status, tier)
     VALUES (?, ?, ?, 'REFCODE', 'active', 'Bronze')`,
  ).run(referralId, referrerId, refereeId);
  db.prepare(
    `INSERT INTO referral_commissions
       (commission_id, referral_id, referrer_id, referee_id, trade_volume, amount, currency, status)
     VALUES (?, ?, ?, ?, 0, ?, ?, 'pending')`,
  ).run(generateId(), referralId, referrerId, refereeId, amount, currency);
}

test('a referred trade records a pending commission', () => {
  const referrer = seedUser();
  const referee = seedUser();
  linkReferral(referrer, referee);

  recordReferredTrade(referee, 10000, 10);

  const rows = pendingCommissions(referrer);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].amount, 2); // Bronze 20% of a 10 fee
});

test('an unfunded pool leaves the commission pending and pays nothing', () => {
  const referrer = seedUser();
  const referee = seedUser();
  linkReferral(referrer, referee);
  recordReferredTrade(referee, 10000, 10);

  const paid = payoutReferralCommissions(referrer);
  assert.equal(paid.length, 0);
  assert.equal(availableBalance(referrer, 'USDT'), 0);
  assert.equal(pendingCommissions(referrer)[0].status, 'pending');
});

test('a funded pool pays the commission exactly once', () => {
  const referrer = seedUser();
  const referee = seedUser();
  linkReferral(referrer, referee);
  recordReferredTrade(referee, 10000, 10);
  fundReferralPool('USDT', 5);

  const paid = payoutReferralCommissions(referrer);
  assert.equal(paid.length, 1);
  assert.equal(availableBalance(referrer, 'USDT'), 2);
  assert.equal(referralPoolBalance('USDT'), 3); // 5 - 2
  assert.equal(pendingCommissions(referrer)[0].status, 'paid');

  // A second claim pays nothing: the commission is no longer pending.
  const again = payoutReferralCommissions(referrer);
  assert.equal(again.length, 0);
  assert.equal(availableBalance(referrer, 'USDT'), 2);
});

test('a short pool pays nothing rather than going negative', () => {
  const referrer = seedUser();
  const referee = seedUser();
  insertCommission(referrer, referee, 2, 'TGR'); // TGR is never funded
  fundReferralPool('USDT', 1); // funded in the wrong asset

  const paid = payoutReferralCommissions(referrer);
  assert.equal(paid.length, 0);
  assert.equal(availableBalance(referrer, 'TGR'), 0);
  assert.equal(referralPoolBalance('TGR'), 0);
  assert.equal(pendingCommissions(referrer)[0].status, 'pending');
});

test('a partially funded pool pays what it can and leaves the rest pending', () => {
  const referrer = seedUser();
  const first = seedUser();
  const second = seedUser();
  insertCommission(referrer, first, 2, 'TGR');
  insertCommission(referrer, second, 3, 'TGR');
  fundReferralPool('TGR', 2); // covers only the oldest commission

  const paid = payoutReferralCommissions(referrer);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].amount, 2);
  assert.equal(availableBalance(referrer, 'TGR'), 2);
  assert.equal(referralPoolBalance('TGR'), 0);

  const rows = pendingCommissions(referrer);
  assert.equal(rows[0].status, 'paid');
  assert.equal(rows[1].status, 'pending');
});
