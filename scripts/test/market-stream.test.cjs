'use strict';
/**
 * Market stream tests against a real database.
 *
 * The stream frame is built from the venue's own book and trade tape. These
 * tests assert that a snapshot reflects real resting orders and settled trades,
 * that a fresh frame is emitted, and that an unchanged market produces no frame.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-stream-')), 'stream.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { readMarketSnapshot, buildStreamFrame, snapshotFingerprint } = require('../../.test-build/market-stream.js');

const db = getDb();

function seedPair(symbol, base, quote) {
  const pairId = generateId();
  db.prepare(
    `INSERT INTO trading_pairs (pair_id, symbol, base_currency, quote_currency, status, tick_size, min_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, ?, ?, 'active', 0.01, 0.0001, 1, 0.001, 0.001)`,
  ).run(pairId, symbol, base, quote);
  return pairId;
}

function seedUser() {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, 'active')`).run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
  );
  return userId;
}

function seedOrder(pairId, user, side, price, remaining) {
  db.prepare(
    `INSERT INTO orders (order_id, user_id, pair_id, side, type, price, quantity, remaining_quantity, status)
     VALUES (?, ?, ?, ?, 'limit', ?, ?, ?, 'open')`,
  ).run(generateId(), user, pairId, side, price, remaining, remaining);
}

function seedTrade(symbol, price, quantity) {
  db.prepare(
    `INSERT INTO spot_trades
       (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id,
        side, price, quantity, quote_quantity, created_at)
     VALUES (?, ?, 'maker', 'taker', 'maker-u', 'taker-u', 'buy', ?, ?, ?, datetime('now'))`,
  ).run(generateId(), symbol, price, quantity, price * quantity);
}

test('the snapshot reflects real resting orders and the trade tape', () => {
  const pairId = seedPair('BTC/USDT', 'BTC', 'USDT');
  const user = seedUser();
  seedOrder(pairId, user, 'buy', 99, 2);
  seedOrder(pairId, user, 'sell', 101, 3);
  seedTrade('BTC/USDT', 100, 1.5);

  const snapshot = readMarketSnapshot('BTC/USDT');
  assert.equal(snapshot.symbol, 'BTC/USDT');
  assert.equal(snapshot.bids[0].price, 99);
  assert.equal(snapshot.asks[0].price, 101);
  assert.equal(snapshot.ticker.lastPrice, 100);
  assert.equal(snapshot.trades.length, 1);
});

test('a fresh snapshot produces a frame and an unchanged one does not', () => {
  const snapshot = readMarketSnapshot('BTC/USDT');
  const frame = buildStreamFrame('', snapshot);
  assert.ok(frame, 'the first snapshot must be sent');
  assert.equal(frame.type, 'market');
  assert.equal(frame.data.trades.length, 1);

  const fingerprint = snapshotFingerprint(snapshot);
  assert.equal(buildStreamFrame(fingerprint, snapshot), null, 'an unchanged market sends nothing');
});

test('a new trade changes the fingerprint and emits a frame', () => {
  const before = readMarketSnapshot('BTC/USDT');
  const fingerprint = snapshotFingerprint(before);
  seedTrade('BTC/USDT', 102, 0.5);
  const after = readMarketSnapshot('BTC/USDT');
  assert.notEqual(snapshotFingerprint(after), fingerprint);
  assert.ok(buildStreamFrame(fingerprint, after));
});

test('an unknown symbol yields an empty book, not a fabricated one', () => {
  const snapshot = readMarketSnapshot('NOPE/NONE');
  assert.equal(snapshot.bids.length, 0);
  assert.equal(snapshot.asks.length, 0);
  assert.equal(snapshot.ticker.lastPrice, null);
});
