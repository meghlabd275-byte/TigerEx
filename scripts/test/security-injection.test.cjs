'use strict';
/**
 * Injection-resistance tests.
 *
 * SQL is built from hardcoded column maps and `?` placeholders, never from
 * request text. These tests drive hostile strings through the real engines and
 * assert the database is unchanged, so a future change that concatenates a
 * value into SQL fails here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-sec-')), 'sec.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance } = require('../../.test-build/ledger.js');
const { placeSpotOrder, listTrades, SpotError } = require('../../.test-build/spot-engine.js');

const db = getDb();

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

test('a SQL-injection symbol is rejected and touches no table', () => {
  const user = seedUser();
  creditWallet(user, 'RUSD', 100000);
  const before = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    pairs: db.prepare('SELECT COUNT(*) AS n FROM trading_pairs').get().n,
    orders: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
  };

  // A symbol that passes the BASE/QUOTE shape but is not listed, and one that
  // carries SQL metacharacters: both must fail closed.
  assert.throws(
    () => placeSpotOrder(user, { symbol: 'ZZZ/RUSD', side: 'buy', type: 'limit', price: 100, quantity: 1 }),
    (e) => e instanceof SpotError && e.code === 'UNKNOWN_SYMBOL',
  );
  assert.throws(
    () => placeSpotOrder(user, { symbol: "BTC/RUSD'; DROP TABLE users; --", side: 'buy', type: 'limit', price: 100, quantity: 1 }),
    (e) => e instanceof SpotError,
  );

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, before.users);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trading_pairs').get().n, before.pairs);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, before.orders);
});

test('a hostile symbol filter returns no rows instead of leaking or erroring', () => {
  const user = seedUser();
  const rows = listTrades(user, "X' OR '1'='1", 50);
  assert.deepEqual(rows, []);
});

test('the ledger refuses non-finite and non-positive amounts', () => {
  const user = seedUser();
  creditWallet(user, 'USDT', 0);
  const { creditAvailable, debitAvailable } = require('../../.test-build/ledger.js');
  for (const bad of [NaN, Infinity, -Infinity, 0, -5]) {
    assert.throws(() => creditAvailable(user, 'USDT', bad, 'spot'), /positive/i);
    assert.throws(() => debitAvailable(user, 'USDT', bad, 'spot'), /positive/i);
  }
  assert.equal(availableBalance(user, 'USDT'), 0);
});

test('a debit beyond the balance fails closed and leaves the balance untouched', () => {
  const user = seedUser();
  creditWallet(user, 'USDT', 10);
  const { debitAvailable } = require('../../.test-build/ledger.js');
  assert.throws(() => debitAvailable(user, 'USDT', 10.0001, 'spot'), /Insufficient/);
  assert.equal(availableBalance(user, 'USDT'), 10);
});
