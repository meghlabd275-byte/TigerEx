'use strict';
/**
 * Market seeding tests against a real database.
 *
 * Seeding must be additive and idempotent: an operator's declared markets are
 * listed once, re-running never duplicates or overwrites them, an invalid entry
 * is reported rather than aborting the list, and nothing is seeded when the
 * variable is unset.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-seed-')), 'seed.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb } = require('../../.test-build/index.js');
const { seedMarkets } = require('../../.test-build/seed.js');

const PAIRS = JSON.stringify([
  { symbol: 'BTC/RUSD', status: 'active', tickSize: 0.01, minPrice: 0.01, maxPrice: 1_000_000, minQuantity: 0.00001, maxQuantity: 10000, minNotional: 1, makerFee: 0.001, takerFee: 0.001 },
  { symbol: 'ETH/RUSD', status: 'active', tickSize: 0.01, minPrice: 0.01, maxPrice: 1_000_000, minQuantity: 0.0001, maxQuantity: 100000, minNotional: 1, makerFee: 0.001, takerFee: 0.001 },
  { symbol: 'BAD', status: 'active' },
]);

test('nothing is seeded when the variable is unset', () => {
  const report = seedMarkets('');
  assert.equal(report.configured, false);
  assert.equal(report.created.length, 0);
});

test('declared markets are listed, invalid entries reported', () => {
  const report = seedMarkets(PAIRS);
  assert.equal(report.configured, true);
  assert.deepEqual(report.created.sort(), ['BTC/RUSD', 'ETH/RUSD']);
  assert.equal(report.invalid.length, 1);
  assert.match(report.invalid[0].error, /symbol/);

  const count = getDb().prepare('SELECT COUNT(*) AS c FROM trading_pairs').get().c;
  assert.equal(count, 2);
});

test('re-running skips existing markets without duplicating', () => {
  const report = seedMarkets(PAIRS);
  assert.equal(report.created.length, 0);
  assert.deepEqual(report.skipped.sort(), ['BTC/RUSD', 'ETH/RUSD']);
  const count = getDb().prepare('SELECT COUNT(*) AS c FROM trading_pairs').get().c;
  assert.equal(count, 2);
});

test('an operator edit is not overwritten by a re-seed', () => {
  getDb().prepare("UPDATE trading_pairs SET status = 'paused' WHERE symbol = 'BTC/RUSD'").run();
  seedMarkets(PAIRS);
  const row = getDb().prepare("SELECT status FROM trading_pairs WHERE symbol = 'BTC/RUSD'").get();
  assert.equal(row.status, 'paused');
});
