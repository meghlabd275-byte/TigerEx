'use strict';
/**
 * Double-entry journal tests against a real database.
 *
 * The journal must refuse an unbalanced entry, chain each entry to the one
 * before it, and detect an entry that is edited or removed after the fact.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-journal-')), 'journal.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb } = require('../../.test-build/index.js');
const {
  recordEntry,
  accountBalance,
  verifyChain,
  entryLegs,
  hashEntry,
  userAccount,
  TREASURY_ACCOUNT,
  EXTERNAL_ACCOUNT,
  JournalError,
} = require('../../.test-build/journal.js');

const db = getDb();
const reset = () => {
  db.prepare('DELETE FROM journal_legs').run();
  db.prepare('DELETE FROM journal_entries').run();
};

test('a balanced deposit entry moves value from external to the user', () => {
  reset();
  const result = recordEntry('USDT', [
    { account: EXTERNAL_ACCOUNT, amount: -100 },
    { account: userAccount('u1'), amount: 100 },
  ], 'deposit');
  assert.ok(result.entryId);
  assert.equal(result.sequence, 1);
  assert.equal(accountBalance(userAccount('u1')), 100);
  assert.equal(accountBalance(EXTERNAL_ACCOUNT), -100);
});

test('an unbalanced entry is refused and writes nothing', () => {
  reset();
  assert.throws(
    () => recordEntry('USDT', [
      { account: EXTERNAL_ACCOUNT, amount: -100 },
      { account: userAccount('u2'), amount: 90 },
    ]),
    (e) => e instanceof JournalError && e.code === 'UNBALANCED_ENTRY',
  );
  assert.equal(verifyChain().entries, 0);
});

test('an entry with a zero or non-finite leg is refused', () => {
  reset();
  assert.throws(
    () => recordEntry('USDT', [{ account: 'a', amount: 0 }, { account: 'b', amount: 0 }]),
    (e) => e instanceof JournalError && e.code === 'INVALID_AMOUNT',
  );
  assert.throws(
    () => recordEntry('USDT', [{ account: 'a', amount: Infinity }, { account: 'b', amount: -Infinity }]),
    (e) => e instanceof JournalError && e.code === 'INVALID_AMOUNT',
  );
});

test('leg order does not change the hash of an equal entry', () => {
  const legs = [
    { account: userAccount('u9'), amount: 5 },
    { account: TREASURY_ACCOUNT, amount: -5 },
  ];
  assert.equal(
    hashEntry(null, 'TGR', 'm', '2026-01-01T00:00:00.000Z', legs),
    hashEntry(null, 'TGR', 'm', '2026-01-01T00:00:00.000Z', [legs[1], legs[0]]),
  );
});

test('a trade entry moves value user-to-user and books the fee', () => {
  reset();
  recordEntry('USDT', [
    { account: userAccount('buyer'), amount: -101 },
    { account: userAccount('seller'), amount: 100 },
    { account: 'fees', amount: 1 },
  ], 'trade');
  assert.equal(accountBalance(userAccount('buyer')), -101);
  assert.equal(accountBalance(userAccount('seller')), 100);
  assert.equal(accountBalance('fees'), 1);
});

test('the chain verifies while intact', () => {
  reset();
  recordEntry('USDT', [{ account: EXTERNAL_ACCOUNT, amount: -1 }, { account: userAccount('a'), amount: 1 }], 'x');
  recordEntry('USDT', [{ account: userAccount('a'), amount: -1 }, { account: userAccount('b'), amount: 1 }], 'y');
  const check = verifyChain();
  assert.deepEqual(check, { ok: true, entries: 2 });
});

test('editing a leg is detected by verifyChain', () => {
  reset();
  const { entryId } = recordEntry('USDT', [
    { account: EXTERNAL_ACCOUNT, amount: -7 },
    { account: userAccount('tamper'), amount: 7 },
  ], 'tamper-me');
  db.prepare('UPDATE journal_legs SET amount = 8 WHERE entry_id = ? AND account = ?').run(entryId, userAccount('tamper'));
  const check = verifyChain();
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'HASH_MISMATCH');
});

test('deleting a non-tail entry is detected as a sequence gap', () => {
  reset();
  const { entryId } = recordEntry('USDT', [
    { account: EXTERNAL_ACCOUNT, amount: -3 },
    { account: userAccount('vanish'), amount: 3 },
  ], 'vanish');
  recordEntry('USDT', [{ account: EXTERNAL_ACCOUNT, amount: -1 }, { account: userAccount('keep'), amount: 1 }], 'keep');
  db.prepare('DELETE FROM journal_legs WHERE entry_id = ?').run(entryId);
  db.prepare('DELETE FROM journal_entries WHERE entry_id = ?').run(entryId);
  const check = verifyChain();
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'SEQUENCE_GAP');
});

test('entryLegs returns the stored legs and they sum to zero', () => {
  reset();
  const { entryId } = recordEntry('BTC', [
    { account: EXTERNAL_ACCOUNT, amount: -0.5 },
    { account: userAccount('btc'), amount: 0.5 },
  ], 'deposit');
  const legs = entryLegs(entryId);
  assert.equal(legs.length, 2);
  assert.equal(legs.reduce((s, l) => s + l.amount, 0), 0);
});
