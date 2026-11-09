'use strict';
/**
 * Convert tests against a real database.
 *
 * A conversion debits the source asset and credits the destination asset. The
 * debit must reach every balance row that holds the source asset: a user can
 * hold the same asset in more than one wallet, and a debit that only touched one
 * row drove that row negative while the total check still passed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-convert-')), 'convert.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance } = require('../../.test-build/ledger.js');
const { executeConvert, ConvertError } = require('../../.test-build/convert.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, kyc_level, kyc_status, status)
     VALUES (?, ?, ?, '2', 'approved', 'active')`,
  ).run(userId, `${userId}@example.com`, hashPassword('password123'));
  return userId;
}

function fund(userId, asset, amount, walletType = 'spot') {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, ?, ?, 'TIGEREX')`,
  ).run(walletId, userId, walletType, asset);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, asset, amount);
}

function setPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (id, symbol, price) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price`,
  ).run(generateId(), symbol, price);
}

function rowsFor(userId, asset) {
  return db
    .prepare(
      `SELECT b.available FROM balances b JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ? AND b.currency = ? ORDER BY b.wallet_id`,
    )
    .all(userId, asset);
}

test('a conversion debits every row that holds the source asset, never going negative', () => {
  setPrice('TGRUSDT', 2);
  const user = seedUser();
  fund(user, 'TGR', 600);
  fund(user, 'TGR', 400); // a second wallet, so TGR sits in two rows

  executeConvert(user, 'TGR', 'USDT', 900);

  const rows = rowsFor(user, 'TGR');
  assert.equal(rows.length, 2);
  for (const row of rows) assert.ok(row.available >= 0, 'no balance row may go negative');
  assert.equal(availableBalance(user, 'TGR'), 100);
  // 900 * 2 = 1800 USDT minus the 0.1% fee taken in TGR-equivalent terms.
  assert.ok(availableBalance(user, 'USDT') > 0);
});

test('a conversion beyond the total available balance is refused and moves nothing', () => {
  setPrice('TGRUSDT', 2);
  const user = seedUser();
  fund(user, 'TGR', 600);
  fund(user, 'TGR', 400);

  assert.throws(
    () => executeConvert(user, 'TGR', 'USDT', 1001),
    (error) => error instanceof ConvertError && error.code === 'INSUFFICIENT_BALANCE',
  );
  assert.equal(availableBalance(user, 'TGR'), 1000);
  assert.equal(availableBalance(user, 'USDT'), 0);
});

test('an unpriced pair is refused rather than converted at an invented rate', () => {
  const user = seedUser();
  fund(user, 'ZZZ', 100);
  assert.throws(
    () => executeConvert(user, 'ZZZ', 'USDT', 10),
    (error) => error instanceof ConvertError && error.code === 'RATE_UNAVAILABLE',
  );
  assert.equal(availableBalance(user, 'ZZZ'), 100);
});
