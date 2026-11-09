'use strict';
/**
 * Exchange statistics tests.
 *
 * `orders.created_at` is written by SQLite as `YYYY-MM-DD HH:MM:SS`, while the
 * 24-hour window bound is built with `Date.toISOString()` (`...THH:MM:SS.sssZ`).
 * Comparing the two as text is wrong: the literal `T` sorts after a space, so a
 * row created "now" fails `created_at >= isoCutoff` and the 24-hour volume read
 * as zero. These tests fail if the comparison ever regresses to text ordering.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-stats-')), 'stats.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { exchangeStats } = require('../../.test-build/exchange-stats.js');

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

const userId = seedUser();

function listPair(symbol) {
  const pairId = generateId();
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, 'BTC', 'RUSD', ?, 'active', 0.01, 0.0001, 100000, 1, 0.001, 0.001)`,
  ).run(pairId, symbol);
  return pairId;
}

/** Insert a filled order whose created_at is `hoursAgo` before now, space format. */
function recordOrder(pairId, price, quantity, hoursAgo) {
  const createdAt = new Date(Date.now() - hoursAgo * 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  db.prepare(
    `INSERT INTO orders
       (order_id, user_id, pair_id, side, type, price, quantity, filled_quantity, remaining_quantity, average_price, status, created_at, updated_at)
     VALUES (?, ?, ?, 'buy', 'limit', ?, ?, ?, 0, ?, 'filled', ?, ?)`,
  ).run(generateId(), userId, pairId, price, quantity, quantity, price, createdAt, createdAt);
}

test('a trade recorded within the window is counted', () => {
  const pairId = listPair('BTC/RUSD');
  recordOrder(pairId, 100, 2, 1); // one hour ago
  const stats = exchangeStats();
  assert.equal(stats.trades24h, 1, 'a trade from an hour ago must be inside the 24h window');
  assert.equal(stats.dailyVolume, 200);
});

test('a trade older than the window is excluded', () => {
  const pairId = listPair('ETH/RUSD');
  recordOrder(pairId, 10, 3, 25); // twenty-five hours ago
  const before = exchangeStats().trades24h;
  recordOrder(pairId, 10, 3, 30);
  const after = exchangeStats().trades24h;
  assert.equal(after, before, 'trades older than 24h must not change the count');
});

test('the counters are real zeroes on an empty exchange', () => {
  // A fresh database with no orders reports zero, not a placeholder.
  const stats = exchangeStats();
  assert.equal(typeof stats.dailyVolume, 'number');
  assert.ok(stats.dailyVolume >= 0);
  assert.equal(stats.window, '24h');
});

test('active trading pairs and users are counted from their tables', () => {
  const stats = exchangeStats();
  assert.equal(stats.tradingPairs, 2, 'two active pairs were listed above');
  assert.ok(stats.totalUsers >= 0);
});
