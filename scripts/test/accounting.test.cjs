'use strict';
/**
 * Journal-backed accounting tests.
 *
 * A deposit and a withdrawal are the only events that change the venue's total
 * liabilities; a trade moves value between users and nets to zero. These check
 * the journal entry matches the materialised balance it accompanies, and that
 * the journal reconciles against the ledger after a real fill.
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
const {
  recordDeposit,
  reverseDeposit,
  recordWithdrawal,
  reverseWithdrawal,
  reconcileJournal,
} = require('../../.test-build/accounting.js');
const { placeSpotOrder } = require('../../.test-build/spot-engine.js');

const db = getDb();
// Reconciliation reads the whole database, so each test starts from a clean
// slate: balances, orders, trades and the journal all cleared together.
const reset = () => {
  db.prepare('DELETE FROM journal_legs').run();
  db.prepare('DELETE FROM journal_entries').run();
  db.prepare('DELETE FROM spot_trades').run();
  db.prepare('DELETE FROM orders').run();
  db.prepare('DELETE FROM transactions').run();
  db.prepare('DELETE FROM balances').run();
};

function seedUser() {
  const userId = generateId();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, status, email_verified)
     VALUES (?, ?, ?, 'active', 1)`,
  ).run(userId, `${userId}@example.com`, hashPassword('password123'));
  return userId;
}

function creditWallet(userId, currency, available) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, created_at)
     VALUES (?, ?, 'spot', ?, 'TIGEREX', datetime('now'))`,
  ).run(walletId, userId, currency);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked)
     VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, currency, available);
}

/** List a base asset against RUSD with the venue's default fee schedule. */
function listPair(base) {
  const symbol = `${base}/RUSD`;
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, 'RUSD', ?, 'active', 0.01, 0.0001, 100000, 1, 0.001, 0.001)`,
  ).run(generateId(), base, symbol);
  return symbol;
}

test('a credited deposit journals external-to-user and agrees with the balance', () => {
  reset();
  const userId = seedUser();
  creditWallet(userId, 'USDT', 0);
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
  const userId = seedUser();
  creditWallet(userId, 'USDT', 0);
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
  const userId = seedUser();
  creditWallet(userId, 'USDT', 0);
  db.transaction(() => {
    creditAvailable(userId, 'USDT', 100, 'spot');
    recordDeposit(userId, 'USDT', 100);
  })();

  db.transaction(() => {
    debitAvailable(userId, 'USDT', 30, 'spot');
    recordWithdrawal(userId, 'USDT', 30, 'withdrawal 0xabc');
  })();
  assert.equal(accountBalance(userAccount(userId)), 70);
  assert.equal(accountBalance(EXTERNAL_ACCOUNT), -70);

  db.transaction(() => {
    creditAvailable(userId, 'USDT', 30, 'spot');
    reverseWithdrawal(userId, 'USDT', 30, 'withdrawal 0xabc reverted');
  })();
  assert.equal(availableBalance(userId, 'USDT'), 100);
  assert.equal(accountBalance(userAccount(userId)), 100);
  assert.equal(verifyChain().ok, true);
});

test('a real spot fill journals balanced entries and reconciles', () => {
  reset();
  const symbol = listPair('ETH');
  const maker = seedUser();
  const taker = seedUser();
  creditWallet(maker, 'ETH', 2);
  creditWallet(taker, 'RUSD', 200000);

  // Seed both deposits so the journal's opening balances match the ledger.
  db.transaction(() => {
    recordDeposit(maker, 'ETH', 2, 'seed');
    recordDeposit(taker, 'RUSD', 200000, 'seed');
  })();

  placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 50000, quantity: 1 });
  placeSpotOrder(taker, { symbol, side: 'buy', type: 'limit', price: 50000, quantity: 1 });

  // Both assets' entries must balance, and the aggregate user holding in the
  // journal must equal the ledger's, per asset.
  const recon = reconcileJournal();
  assert.equal(recon.ok, true, JSON.stringify(recon.entries));
  assert.equal(recon.chain.ok, true);
  for (const entry of recon.entries) {
    assert.equal(entry.ok, true, `${entry.asset}: ${JSON.stringify(entry)}`);
  }
  // The venue's fee account holds both fees.
  assert.ok(accountBalance('fees') > 0);
});

test('the journal user-account total equals the ledger across several accounts', () => {
  reset();
  const a = seedUser();
  const b = seedUser();
  creditWallet(a, 'USDT', 0);
  creditWallet(b, 'USDT', 0);
  db.transaction(() => {
    creditAvailable(a, 'USDT', 10, 'spot');
    recordDeposit(a, 'USDT', 10);
    creditAvailable(b, 'USDT', 15, 'spot');
    recordDeposit(b, 'USDT', 15);
  })();
  const journalTotal = accountBalance(userAccount(a)) + accountBalance(userAccount(b));
  assert.equal(journalTotal, availableBalance(a, 'USDT') + availableBalance(b, 'USDT'));
  assert.equal(journalTotal, 25);
  assert.equal(reconcileJournal().ok, true);
});
