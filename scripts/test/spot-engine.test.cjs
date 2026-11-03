'use strict';
/**
 * Integration tests for the DB-backed spot settlement engine.
 *
 * The schema comes from the production code path, orders are placed through
 * `placeSpotOrder`, and every assertion reads the real balance and trade rows
 * afterwards. Nothing is stubbed: these tests fail if the reservation, the
 * matching, the fee split or the settlement disagree with each other.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-spot-')), 'spot.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const {
  placeSpotOrder,
  cancelSpotOrder,
  listOpenOrders,
  listTrades,
  SpotError,
} = require('../../.test-build/spot-engine.js');
const { orderBookDepth, rolling24h } = require('../../.test-build/market-view.js');

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
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, currency, available);
}

/**
 * List a base asset against RUSD.
 *
 * Each test uses its own base so its resting orders form an independent book;
 * a shared symbol would let one test's leftover liquidity change another's
 * fills.
 */
function listPair(base, tickSize = 0.01, minQuantity = 0.0001) {
  const symbol = `${base}/RUSD`;
  const pairId = generateId();
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, 'RUSD', ?, 'active', ?, ?, 100000, 1, 0.001, 0.001)`,
  ).run(pairId, base, symbol, tickSize, minQuantity);
  return symbol;
}

test('a resting sell is taken by a market buy and both sides settle', () => {
  const symbol = listPair('BTC');
  const maker = seedUser();
  const taker = seedUser();
  credit(maker, 'BTC', 2);
  credit(taker, 'RUSD', 200000);

  const sell = placeSpotOrder(maker, {
    symbol,
    side: 'sell',
    type: 'limit',
    price: 50000,
    quantity: 1,
  });
  assert.equal(sell.status, 'open');
  assert.equal(availableBalance(maker, 'BTC'), 1);
  assert.equal(lockedBalance(maker, 'BTC'), 1);

  const buy = placeSpotOrder(taker, {
    symbol,
    side: 'buy',
    type: 'market',
    quantity: 1,
  });
  assert.equal(buy.status, 'filled');
  assert.equal(buy.filledQuantity, 1);
  assert.equal(buy.averagePrice, 50000);

  // The taker pays 50,000 RUSD and a 10 bps fee taken in the BTC it receives.
  const takerFee = 1 * 0.001;
  assert.equal(availableBalance(taker, 'BTC'), 1 - takerFee);
  assert.equal(availableBalance(taker, 'RUSD'), 200000 - 50000);

  // The maker receives 50,000 RUSD less its 10 bps fee and gives up its BTC.
  const makerFee = 50000 * 0.001;
  assert.equal(availableBalance(maker, 'RUSD'), 50000 - makerFee);
  assert.equal(availableBalance(maker, 'BTC'), 1);
  assert.equal(lockedBalance(maker, 'BTC'), 0);
});


test('an order without the balance to settle is refused and reserves nothing', () => {
  const symbol = listPair('WBTC');
  const user = seedUser();
  credit(user, 'RUSD', 10);

  assert.throws(
    () => placeSpotOrder(user, { symbol, side: 'buy', type: 'limit', price: 50000, quantity: 1 }),
    (error) => error instanceof SpotError && error.code === 'INSUFFICIENT_BALANCE',
  );

  assert.equal(availableBalance(user, 'RUSD'), 10);
  assert.equal(lockedBalance(user, 'RUSD'), 0);
  assert.equal(listOpenOrders(user, null).length, 0);
});


test('cancelling a resting order releases the reservation exactly once', () => {
  const symbol = listPair('CBTC');
  const user = seedUser();
  credit(user, 'CBTC', 5);

  const order = placeSpotOrder(user, { symbol, side: 'sell', type: 'limit', price: 60000, quantity: 2 });
  assert.equal(lockedBalance(user, 'CBTC'), 2);

  const cancelled = cancelSpotOrder(user, order.orderId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(availableBalance(user, 'CBTC'), 5);
  assert.equal(lockedBalance(user, 'CBTC'), 0);

  // A second cancellation is a terminal-state error, not a second release.
  assert.throws(
    () => cancelSpotOrder(user, order.orderId),
    (error) => error instanceof SpotError && error.code === 'TERMINAL_ORDER',
  );
  assert.equal(availableBalance(user, 'CBTC'), 5);
});


test('a partially filled order releases only the unfilled reservation', () => {
  const symbol = listPair('PBTC');
  const maker = seedUser();
  const taker = seedUser();
  credit(maker, 'PBTC', 5);
  credit(taker, 'RUSD', 200000);

  const sell = placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 40000, quantity: 4 });
  assert.equal(lockedBalance(maker, 'PBTC'), 4);

  placeSpotOrder(taker, { symbol, side: 'buy', type: 'market', quantity: 1 });
  assert.equal(lockedBalance(maker, 'PBTC'), 3);

  cancelSpotOrder(maker, sell.orderId);
  assert.equal(availableBalance(maker, 'PBTC'), 4);
  assert.equal(lockedBalance(maker, 'PBTC'), 0);
});


test('a price that is not a tick multiple is refused', () => {
  const symbol = listPair('TBTC');
  const user = seedUser();
  credit(user, 'RUSD', 200000);

  assert.throws(
    () => placeSpotOrder(user, { symbol, side: 'buy', type: 'limit', price: 50000.005, quantity: 0.01 }),
    (error) => error instanceof SpotError && error.code === 'INVALID_TICK',
  );
});


test('a post-only order that would cross is rejected instead of taking', () => {
  const symbol = listPair('OBTC');
  const maker = seedUser();
  const taker = seedUser();
  credit(maker, 'OBTC', 1);
  credit(taker, 'RUSD', 200000);

  placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 45000, quantity: 1 });

  const result = placeSpotOrder(taker, {
    symbol,
    side: 'buy',
    type: 'limit',
    price: 46000,
    quantity: 1,
    postOnly: true,
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.filledQuantity, 0);
  // The reservation was released because nothing rested.
  assert.equal(lockedBalance(taker, 'RUSD'), 0);
  assert.equal(availableBalance(taker, 'RUSD'), 200000);
});


test('fill-or-kill is refused when the book cannot fill it whole', () => {
  const symbol = listPair('FBT');
  const maker = seedUser();
  const taker = seedUser();
  credit(maker, 'FBT', 1);
  credit(taker, 'RUSD', 500000);

  placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 50000, quantity: 1 });

  const result = placeSpotOrder(taker, {
    symbol,
    side: 'buy',
    type: 'limit',
    price: 50000,
    quantity: 2,
    timeInForce: 'FOK',
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.filledQuantity, 0);
  assert.equal(availableBalance(taker, 'RUSD'), 500000);
  assert.equal(lockedBalance(taker, 'RUSD'), 0);
});


test('a market order with an empty book is refused rather than resting', () => {
  const symbol = listPair('EBTC');
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  assert.throws(
    () => placeSpotOrder(user, { symbol, side: 'buy', type: 'market', quantity: 0.01 }),
    (error) => error instanceof SpotError && error.code === 'NO_LIQUIDITY',
  );
  assert.equal(listOpenOrders(user, null).length, 0);
});


test('an unlisted symbol is refused', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  assert.throws(
    () => placeSpotOrder(user, { symbol: 'FAKE/RUSD', side: 'buy', type: 'limit', price: 1, quantity: 1 }),
    (error) => error instanceof SpotError && error.code === 'UNKNOWN_SYMBOL',
  );
});


test('depth is aggregated from resting orders and the tape from settled trades', () => {
  const symbol = listPair('ETH');
  const maker = seedUser();
  credit(maker, 'ETH', 3);

  placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 3000, quantity: 1 });

  const depth = orderBookDepth(symbol, 10);
  assert.equal(depth.asks.length, 1);
  assert.equal(depth.asks[0].price, 3000);
  assert.equal(depth.asks[0].quantity, 1);
  assert.equal(depth.asks[0].total, 1);
  assert.equal(depth.bestAsk, 3000);
  assert.equal(depth.bestBid, null);
  assert.equal(depth.lastPrice, null);
});


test('24h statistics come from settled trades, not a placeholder', () => {
  assert.equal(rolling24h('NOPE/RUSD'), null);

  const symbol = listPair('SOL');
  const maker = seedUser();
  const taker = seedUser();
  credit(maker, 'SOL', 10);
  credit(taker, 'RUSD', 1000000);

  placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 100, quantity: 5 });
  placeSpotOrder(taker, { symbol, side: 'buy', type: 'market', quantity: 5 });

  const stats = rolling24h(symbol);
  assert.ok(stats);
  assert.equal(stats.lastPrice, 100);
  assert.equal(stats.high, 100);
  assert.equal(stats.low, 100);
  assert.equal(stats.volume, 5);
  assert.equal(stats.trades, 1);
});


test('a settled trade is visible to both counterparties with its own fee', () => {
  const symbol = listPair('TGR', 0.0001, 1);
  const maker = seedUser();
  const taker = seedUser();
  credit(maker, 'TGR', 100);
  credit(taker, 'RUSD', 100000);

  placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 10, quantity: 100 });
  placeSpotOrder(taker, { symbol, side: 'buy', type: 'market', quantity: 100 });

  const makerTrades = listTrades(maker, symbol, 10);
  const takerTrades = listTrades(taker, symbol, 10);

  assert.equal(makerTrades.length, 1);
  assert.equal(takerTrades.length, 1);
  assert.equal(makerTrades[0].role, 'maker');
  assert.equal(takerTrades[0].role, 'taker');
  assert.equal(makerTrades[0].side, 'sell');
  assert.equal(takerTrades[0].side, 'buy');
  assert.equal(makerTrades[0].total, 1000);
  assert.ok(makerTrades[0].fee > 0);
  assert.ok(takerTrades[0].fee > 0);
});

