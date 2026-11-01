'use strict';
/**
 * Integration tests for the portfolio summary against a real database.
 *
 * The schema is created by the production code path (`getDb`), rows are
 * inserted with real SQL, and the summary is computed from those rows. Nothing
 * is stubbed, so these tests fail if the schema, the queries or the valuation
 * logic disagree with each other.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-test-')), 'ledger.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { portfolioSummary, usdPrice } = require('../../.test-build/portfolio.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, 'active')`,
  ).run(userId, `${userId}@example.com`, hashPassword('password123'));
  return userId;
}

function credit(userId, currency, available, locked = 0) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'native')`,
  ).run(walletId, userId, currency);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(generateId(), walletId, currency, available, locked);
}

function listPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (id, symbol, price) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, updated_at = datetime('now')`,
  ).run(generateId(), symbol, price);
}

function ensurePair(pairId) {
  db.prepare(
    `INSERT INTO trading_pairs (pair_id, base_currency, quote_currency, symbol)
     VALUES (?, ?, 'USDT', ?)
     ON CONFLICT(pair_id) DO NOTHING`,
  ).run(pairId, pairId.replace(/USDT$/, ''), pairId);
}

function recordFill(userId, pairId, side, quantity, averagePrice, fee, createdAt) {
  ensurePair(pairId);
  const orderId = generateId();
  db.prepare(
    `INSERT INTO orders (order_id, user_id, pair_id, side, type, quantity, filled_quantity, status)
     VALUES (?, ?, ?, ?, 'limit', ?, ?, 'filled')`,
  ).run(orderId, userId, pairId, side, quantity, quantity);
  db.prepare(
    `INSERT INTO order_history (history_id, order_id, user_id, pair_id, side, type,
                                quantity, filled_quantity, average_price, fee, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'limit', ?, ?, ?, ?, 'filled', ?)`,
  ).run(generateId(), orderId, userId, pairId, side, quantity, quantity, averagePrice, fee, createdAt);
}

test('an account with no ledger rows reports zero and no holdings', () => {
  const summary = portfolioSummary(seedUser());
  assert.deepEqual(summary.holdings, []);
  assert.equal(summary.totalBalanceUSDT, 0);
  assert.equal(summary.realizedPnlUSDT, 0);
  assert.equal(summary.openOrders, 0);
});

test('holdings are valued at the live listed price', () => {
  const userId = seedUser();
  credit(userId, 'BTC', 0.5);
  listPrice('BTCUSDT', 60000);

  const summary = portfolioSummary(userId);
  assert.equal(summary.holdings.length, 1);
  assert.equal(summary.holdings[0].usdPrice, 60000);
  assert.equal(summary.holdings[0].usdValue, 30000);
  assert.ok(Math.abs(summary.totalBalanceUSDT - 30000) < 1e-6);
  assert.deepEqual(summary.unpricedAssets, []);
});

test('locked balances are counted in the valuation', () => {
  const userId = seedUser();
  credit(userId, 'ETH', 1, 1);
  listPrice('ETHUSDT', 2000);

  const summary = portfolioSummary(userId);
  assert.equal(summary.holdings[0].usdValue, 4000);
  assert.equal(summary.totalBalanceUSDT, 4000);
});

test('an asset with no listed price is unpriced, not valued at an invented rate', () => {
  const userId = seedUser();
  credit(userId, 'OBSCURE', 1000);

  const summary = portfolioSummary(userId);
  assert.equal(summary.holdings[0].usdValue, null);
  assert.equal(summary.holdings[0].usdPrice, null);
  assert.equal(summary.totalBalanceUSDT, 0);
  assert.deepEqual(summary.unpricedAssets, ['OBSCURE']);
});

test('stablecoins are valued at par without needing a listed pair', () => {
  assert.equal(usdPrice('USDT'), 1);
  assert.equal(usdPrice('RUSD'), 1);
  assert.equal(usdPrice('usdc'), 1);

  const userId = seedUser();
  credit(userId, 'USDT', 250);
  assert.equal(portfolioSummary(userId).totalBalanceUSDT, 250);
});

test('balances held in separate wallets are merged into one holding', () => {
  const userId = seedUser();
  credit(userId, 'BTC', 0.1);
  credit(userId, 'BTC', 0.2, 0.3);
  listPrice('BTCUSDT', 50000);

  const summary = portfolioSummary(userId);
  assert.equal(summary.holdings.length, 1);
  // Balances are stored as REAL, so two credits of 0.1 and 0.2 sum to
  // 0.30000000000000004 rather than exactly 0.3.
  assert.ok(Math.abs(summary.holdings[0].available - 0.3) < 1e-12);
  assert.equal(summary.holdings[0].locked, 0.3);
  assert.ok(Math.abs(summary.totalBalanceUSDT - 30000) < 1e-6);
});

test('realized P&L comes from the recorded fills', () => {
  const userId = seedUser();
  recordFill(userId, 'BTCUSDT', 'buy', 1, 100, 0, '2025-01-01 00:00:00');
  recordFill(userId, 'BTCUSDT', 'sell', 1, 150, 0, '2025-01-02 00:00:00');

  assert.equal(portfolioSummary(userId).realizedPnlUSDT, 50);
});

test('open orders are counted and settled orders are not', () => {
  const userId = seedUser();
  ensurePair('BTCUSDT');
  for (const status of ['pending', 'open', 'partially_filled']) {
    db.prepare(
      `INSERT INTO orders (order_id, user_id, pair_id, side, type, quantity, status)
       VALUES (?, ?, 'BTCUSDT', 'buy', 'limit', 1, ?)`,
    ).run(generateId(), userId, status);
  }
  db.prepare(
    `INSERT INTO orders (order_id, user_id, pair_id, side, type, quantity, status)
     VALUES (?, ?, 'BTCUSDT', 'buy', 'limit', 1, 'filled')`,
  ).run(generateId(), userId);

  assert.equal(portfolioSummary(userId).openOrders, 3);
});

test('one account cannot see another account ledger', () => {
  const alice = seedUser();
  const bob = seedUser();
  credit(alice, 'BTC', 1);
  listPrice('BTCUSDT', 10000);

  assert.equal(portfolioSummary(alice).totalBalanceUSDT, 10000);
  assert.equal(portfolioSummary(bob).totalBalanceUSDT, 0);
  assert.equal(portfolioSummary(bob).holdings.length, 0);
});

test.after(() => {
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});
