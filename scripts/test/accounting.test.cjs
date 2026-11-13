'use strict';
/**
 * Journal-backed accounting tests.
 *
 * A deposit and a withdrawal are the only events that change the venue's total
 * liabilities. This checks the journal entry matches the materialised balance
 * it accompanies, and that the chain stays intact.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-acct-')), 'acct.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { creditAvailable, debitAvailable, availableBalance } = require('../../.test-build/ledger.js');
const { accountBalance, verifyChain, userAccount, EXTERNAL_ACCOUNT } = require('../../.test-build/journal.js');
const { recordDeposit, reverseDeposit, recordWithdrawal, reverseWithdrawal } = require('../../.test-build/accounting.js');

const db = getDb();
const reset = () => {
  db.prepare('DELETE FROM journal_legs').run();
  db.prepare('DELETE FROM journal_entries').run();
};

function seedWallet() {
  const userId = generateId();
  const walletId = generateId();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, status, email_verified)
     VALUES (?, ?, ?, 'active', 1)`,
  ).run(userId, `${userId}@example.com`, hashPassword('password123'));
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, created_at)
     VALUES (?, ?, 'spot', 'USDT', 'TIGEREX', datetime('now'))`,
  ).run(walletId, userId);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked)
     VALUES (?, ?, 'USDT', 0, 0)`,
  ).run(generateId(), walletId);
  return userId;
}

test('a credited deposit journals external-to-user and agrees with the balance', () => {
  reset();
  const userId = seedWallet();
  // This is what the deposit scanner does, in one transaction.
  db.transaction(() => {
    creditAvailable(userId, 'USDT', 250, 'spot');
    recordDeposit(userId, 'USDT', 250, 'test deposit');
  })();

  assert.equal(availableBalance(userId, 'USDT'), 250);
  assert.equal(accountBalance(userAccount(userId)), 250);
  assert.equal(accountBalance(EXTERNAL_ACCOUNT), -250);
  assert.equal(verifyChain().ok, true);
});

test('a reorg reversal journals back to zero', () => {
  reset();
  const userId = seedWallet();
  db.transaction(() => {
    creditAvailable(userId, 'USDT', 40, 'spot');
    recordDeposit(userId, 'USDT', 40);
  })();
  db.transaction(() => {
    debitAvailable(userId, 'USDT', 40, 'spot');
    reverseDeposit(userId, 'USDT', 40);
  })();
  assert.equal(availableBalance(userId, 'USDT'), 0);
  assert.equal(accountBalance(userAccount(userId)), 0);
  assert.equal(accountBalance(EXTERNAL_ACCOUNT), 0);
  assert.equal(verifyChain().ok, true);
});

test('a withdrawal journals user-to-external and a revert unwinds it', () => {
  reset();
  const userId = seedWallet();
  db.transaction(() => {
    creditAvailable(userId, 'USDT', 100, 'spot');
    recordDeposit(userId, 'USDT', 100);
  })();

  // Broadcast: the reservation is consumed and leaves the venue.
  db.transaction(() => {
    db.prepare("UPDATE balances SET available = available - 30 WHERE wallet_id IN (SELECT wallet_id FROM wallets WHERE user_id = ?)").run(userId);
    recordWithdrawal(userId, 'USDT', 30, 'withdrawal 0xabc');
  })();
  assert.equal(accountBalance(userAccount(userId)), 70);
  assert.equal(accountBalance(EXTERNAL_ACCOUNT), -70);

  // Reverted: the value returns to the user.
  db.transaction(() => {
    creditAvailable(userId, 'USDT', 30, 'spot');
    reverseWithdrawal(userId, 'USDT', 30, 'withdrawal 0xabc reverted');
  })();
  assert.equal(availableBalance(userId, 'USDT'), 100);
  assert.equal(accountBalance(userAccount(userId)), 100);
  assert.equal(verifyChain().ok, true);
});

test('the journal user-account total equals the ledger across several accounts', () => {
  reset();
  const a = seedWallet();
  const b = seedWallet();
  db.transaction(() => {
    creditAvailable(a, 'USDT', 10, 'spot');
    recordDeposit(a, 'USDT', 10);
    creditAvailable(b, 'USDT', 15, 'spot');
    recordDeposit(b, 'USDT', 15);
  })();
  const journalTotal = accountBalance(userAccount(a)) + accountBalance(userAccount(b));
  assert.equal(journalTotal, availableBalance(a, 'USDT') + availableBalance(b, 'USDT'));
  assert.equal(journalTotal, 25);
});
