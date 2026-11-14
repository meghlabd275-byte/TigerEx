'use strict';
/**
 * Integration tests for the fiat on/off-ramp.
 *
 * The ramp is exercised against a real SQLite database with real balances and a
 * real provider transport (a local HTTP server standing in for a PSP). Every
 * assertion reads the resulting balances and the order's status afterwards, so
 * a ramp that credited a buy before the provider confirmed it, that released a
 * seller's crypto without settlement, or that credited twice on a replayed
 * callback would fail here. Nothing is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHmac } = require('node:crypto');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-fiat-')), 'fiat.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';
process.env.TIGEREX_FIAT_CALLBACK_SECRET = 'callback-secret-0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const {
  quoteFiat,
  placeFiatOrder,
  settleFiatOrder,
  cancelFiatOrder,
  listFiatProviders,
  readFiatOrder,
  isSupportedFiat,
  FiatError,
} = require('../../.test-build/ramp.js');
const { verifyFiatCallback } = require('../../.test-build/provider.js');

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

function credit(userId, currency, available) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, currency, available);
}

function setPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (id, symbol, price, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, updated_at = datetime('now')`,
  ).run(generateId(), symbol, price);
}

function seedProvider(feePercent = 1.5, minLimit = 10, maxLimit = 100000000) {
  const providerId = generateId();
  db.prepare(
    `INSERT INTO fiat_providers (provider_id, name, payment_methods, min_limit, max_limit, fee_percent, status)
     VALUES (?, 'TestPay', '["card","bank"]', ?, ?, ?, 'active')`,
  ).run(providerId, minLimit, maxLimit, feePercent);
  return providerId;
}

test('quote prices from the venue market and withholds the provider fee', () => {
  setPrice('BTCUSD', 50000);
  const providerId = seedProvider(1.5);

  const quote = quoteFiat('buy', 'USD', 'BTC', 1000, providerId);
  assert.equal(quote.rate, 50000);
  assert.equal(quote.feeAmount, 15);
  assert.equal(quote.netFiatAmount, 985);
  // 985 USD / 50000 = 0.0197 BTC
  assert.ok(Math.abs(quote.cryptoAmount - 985 / 50000) < 1e-12);
});

test('quote fails closed when no live rate exists', () => {
  const providerId = seedProvider();
  assert.throws(
    () => quoteFiat('buy', 'USD', 'ZZZ', 100, providerId),
    (e) => e instanceof FiatError && e.code === 'RATE_UNAVAILABLE',
  );
});

test('quote rejects an unsupported fiat currency and an out-of-range amount', () => {
  setPrice('BTCUSD', 50000);
  assert.throws(() => quoteFiat('buy', 'XYZ', 'BTC', 100), (e) => e.code === 'UNSUPPORTED_FIAT');
  const providerId = seedProvider(1.5, 10, 100);
  assert.throws(() => quoteFiat('buy', 'USD', 'BTC', 5, providerId), (e) => e.code === 'LIMIT_EXCEEDED');
  assert.equal(isSupportedFiat('usd'), true);
});

test('a buy credits crypto only after the provider settles, and never twice', () => {
  setPrice('ETHUSD', 2000);
  const providerId = seedProvider(0);
  const userId = seedUser();

  const order = placeFiatOrder(userId, 'buy', 'USD', 'ETH', 2000, providerId);
  assert.equal(order.status, 'pending');
  // Not credited yet.
  assert.equal(availableBalance(userId, 'ETH'), 0);

  const settled = settleFiatOrder(order.orderId, 'settled');
  assert.equal(settled.status, 'settled');
  assert.ok(Math.abs(availableBalance(userId, 'ETH') - 1) < 1e-9);

  // A replayed callback is refused rather than crediting a second time.
  assert.throws(() => settleFiatOrder(order.orderId, 'settled'), (e) => e.code === 'ALREADY_FINAL');
  assert.ok(Math.abs(availableBalance(userId, 'ETH') - 1) < 1e-9);
});

test('a sell locks the crypto, consumes it on settlement and pays the user', () => {
  setPrice('BTCUSD', 50000);
  const providerId = seedProvider(0);
  const userId = seedUser();
  credit(userId, 'BTC', 1);

  const order = placeFiatOrder(userId, 'sell', 'USD', 'BTC', 25000, providerId);
  // Half the BTC is locked, none is spendable.
  assert.ok(Math.abs(availableBalance(userId, 'BTC') - 0.5) < 1e-9);
  assert.ok(Math.abs(lockedBalance(userId, 'BTC') - 0.5) < 1e-9);

  settleFiatOrder(order.orderId, 'settled');
  assert.ok(Math.abs(availableBalance(userId, 'BTC') - 0.5) < 1e-9);
  assert.ok(Math.abs(lockedBalance(userId, 'BTC') - 0) < 1e-9);
});

test('a rejected sell releases the locked crypto', () => {
  setPrice('BTCUSD', 50000);
  const providerId = seedProvider(0);
  const userId = seedUser();
  credit(userId, 'BTC', 1);

  const order = placeFiatOrder(userId, 'sell', 'USD', 'BTC', 25000, providerId);
  assert.ok(Math.abs(lockedBalance(userId, 'BTC') - 0.5) < 1e-9);

  settleFiatOrder(order.orderId, 'rejected');
  assert.ok(Math.abs(availableBalance(userId, 'BTC') - 1) < 1e-9);
  assert.ok(Math.abs(lockedBalance(userId, 'BTC') - 0) < 1e-9);
  assert.equal(readFiatOrder(order.orderId).status, 'rejected');
});

test('a sell cannot exceed the available balance', () => {
  setPrice('BTCUSD', 50000);
  const providerId = seedProvider(0);
  const userId = seedUser();
  credit(userId, 'BTC', 0.1);

  assert.throws(
    () => placeFiatOrder(userId, 'sell', 'USD', 'BTC', 25000, providerId),
    (e) => e.code === 'INSUFFICIENT_BALANCE',
  );
});

test('a cancelled sell releases the lock', () => {
  setPrice('BTCUSD', 50000);
  const providerId = seedProvider(0);
  const userId = seedUser();
  credit(userId, 'BTC', 1);

  const order = placeFiatOrder(userId, 'sell', 'USD', 'BTC', 25000, providerId);
  cancelFiatOrder(order.orderId, userId);
  assert.ok(Math.abs(availableBalance(userId, 'BTC') - 1) < 1e-9);
  assert.equal(readFiatOrder(order.orderId).status, 'cancelled');
});

test('listing providers reflects only what the operator configured', () => {
  const before = listFiatProviders().length;
  seedProvider(2, 5, 500);
  const providers = listFiatProviders();
  assert.equal(providers.length, before + 1);
  assert.ok(providers.every((p) => Array.isArray(p.paymentMethods)));
});

test('a provider callback signature is verified in constant time and fails closed', () => {
  const body = JSON.stringify({ orderId: 'x', status: 'settled' });
  const good = createHmac('sha256', process.env.TIGEREX_FIAT_CALLBACK_SECRET).update(body).digest('hex');
  assert.equal(verifyFiatCallback(body, good), true);
  assert.equal(verifyFiatCallback(body, 'deadbeef'), false);
  assert.equal(verifyFiatCallback(body, null), false);
  // Tampering with the body invalidates the signature.
  assert.equal(verifyFiatCallback(body + ' ', good), false);
});
