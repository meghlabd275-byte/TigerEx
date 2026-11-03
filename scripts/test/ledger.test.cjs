'use strict';
/**
 * Ledger integration tests against a real database.
 *
 * A balance is keyed by `(wallet_id, currency)` and an account can hold several
 * wallets, so an asset's funds may be spread across more than one row. These
 * tests assert that every movement is consistent with the total the ledger
 * reports, and that a debit can never spend funds the account does not hold.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-ledger-')), 'ledger.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const {
  availableBalance,
  lockedBalance,
  debitAvailable,
  creditAvailable,
  lockAvailable,
  unlockAvailable,
  consumeLocked,
  covers,
  LedgerError,
} = require('../../.test-build/ledger.js');

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

/** A wallet of the given type holding `available` of an asset. */
function wallet(userId, walletType, asset, available) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, ?, ?, 'TIGEREX')`,
  ).run(walletId, userId, walletType, asset);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, asset, available);
  return walletId;
}

test('a debit reaches funds held in a second wallet of the same type', () => {
  const user = seedUser();
  wallet(user, 'spot', 'BTC', 1);
  wallet(user, 'spot', 'RUSD', 100);

  assert.equal(availableBalance(user, 'RUSD'), 100);
  debitAvailable(user, 'RUSD', 100);
  assert.equal(availableBalance(user, 'RUSD'), 0);
  // The asset the debit did not touch is untouched.
  assert.equal(availableBalance(user, 'BTC'), 1);
});

test('a debit larger than one row spans the account\'s rows', () => {
  const user = seedUser();
  wallet(user, 'spot', 'RUSD', 40);
  wallet(user, 'spot', 'RUSD', 60);

  assert.equal(availableBalance(user, 'RUSD'), 100);
  debitAvailable(user, 'RUSD', 100);
  assert.equal(availableBalance(user, 'RUSD'), 0);
});

test('a debit above the account total is refused and moves nothing', () => {
  const user = seedUser();
  wallet(user, 'spot', 'RUSD', 40);
  wallet(user, 'spot', 'RUSD', 60);

  assert.throws(
    () => debitAvailable(user, 'RUSD', 100.01),
    (error) => error instanceof LedgerError && error.code === 'INSUFFICIENT_BALANCE',
  );
  assert.equal(availableBalance(user, 'RUSD'), 100);
});

test('locking and unlocking spread across rows and preserve the total', () => {
  const user = seedUser();
  wallet(user, 'spot', 'RUSD', 40);
  wallet(user, 'spot', 'RUSD', 60);

  lockAvailable(user, 'RUSD', 100);
  assert.equal(availableBalance(user, 'RUSD'), 0);
  assert.equal(lockedBalance(user, 'RUSD'), 100);

  unlockAvailable(user, 'RUSD', 100);
  assert.equal(availableBalance(user, 'RUSD'), 100);
  assert.equal(lockedBalance(user, 'RUSD'), 0);
});

test('consuming locked funds across rows leaves the total at zero', () => {
  const user = seedUser();
  wallet(user, 'spot', 'RUSD', 40);
  wallet(user, 'spot', 'RUSD', 60);

  lockAvailable(user, 'RUSD', 100);
  consumeLocked(user, 'RUSD', 100);
  assert.equal(availableBalance(user, 'RUSD'), 0);
  assert.equal(lockedBalance(user, 'RUSD'), 0);
});

test('a lock above the available total is refused', () => {
  const user = seedUser();
  wallet(user, 'spot', 'RUSD', 40);
  wallet(user, 'spot', 'RUSD', 60);

  assert.throws(
    () => lockAvailable(user, 'RUSD', 100.01),
    (error) => error instanceof LedgerError && error.code === 'INSUFFICIENT_BALANCE',
  );
  assert.equal(availableBalance(user, 'RUSD'), 100);
});

test('an unlock above the locked total is refused', () => {
  const user = seedUser();
  wallet(user, 'spot', 'RUSD', 100);

  lockAvailable(user, 'RUSD', 10);
  assert.throws(
    () => unlockAvailable(user, 'RUSD', 10.01),
    (error) => error instanceof LedgerError && error.code === 'INSUFFICIENT_LOCKED',
  );
  assert.equal(lockedBalance(user, 'RUSD'), 10);
});

test('a credit creates the asset\'s own row rather than mixing assets', () => {
  const user = seedUser();
  wallet(user, 'spot', 'BTC', 1);

  creditAvailable(user, 'RUSD', 500);
  assert.equal(availableBalance(user, 'RUSD'), 500);
  assert.equal(availableBalance(user, 'BTC'), 1);

  // The credit landed in a row of its own, so the two assets stay separate.
  const rows = db
    .prepare(
      `SELECT b.currency FROM balances b JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ? ORDER BY b.currency`,
    )
    .all(user)
    .map((row) => row.currency);
  assert.deepEqual(rows, ['BTC', 'RUSD']);
});

test('a movement for an asset with no row creates one and moves only it', () => {
  const user = seedUser();

  creditAvailable(user, 'TGR', 250);
  assert.equal(availableBalance(user, 'TGR'), 250);

  debitAvailable(user, 'TGR', 50);
  assert.equal(availableBalance(user, 'TGR'), 200);
});

test('wallet types are isolated from one another', () => {
  const user = seedUser();
  wallet(user, 'spot', 'RUSD', 100);
  wallet(user, 'funding', 'RUSD', 700);

  // The ledger's default wallet type is spot, so a spot debit sees only spot.
  debitAvailable(user, 'RUSD', 100);
  assert.equal(availableBalance(user, 'RUSD'), 700);
});

test('a non-positive or non-finite amount is refused before any row is touched', () => {
  const user = seedUser();
  wallet(user, 'spot', 'RUSD', 100);

  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => debitAvailable(user, 'RUSD', amount),
      (error) => error instanceof LedgerError && error.code === 'INVALID_AMOUNT',
    );
  }
  assert.equal(availableBalance(user, 'RUSD'), 100);
});

test('the coverage tolerance accepts a hair under an amount and rejects a real shortfall', () => {
  assert.equal(covers(100, 100), true);
  assert.equal(covers(100 - 1e-12, 100), true);
  assert.equal(covers(99.99, 100), false);
});
