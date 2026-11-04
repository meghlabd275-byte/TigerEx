'use strict';
/**
 * Tests for candle aggregation and the public market views.
 *
 * The schema and the trade rows come from the production code path, and every
 * assertion reads the aggregated result. Nothing is stubbed: these tests fail
 * if the bucketing, the UTC timestamp handling or the 24-hour statistics
 * disagree with the rows the exchange recorded.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-candles-')), 'candles.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId } = require('../../.test-build/index.js');
const { candlesFor, candlesAsArrays, intervalMs, parseUtcTimestamp } = require('../../.test-build/candles.js');
const { listedMarkets, rolling24h } = require('../../.test-build/market-view.js');

const db = getDb();

function listPair(base, symbol) {
  const pairId = generateId();
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, 'RUSD', ?, 'active', 0.01, 0.0001, 100000, 1, 0.001, 0.001)`,
  ).run(pairId, base, symbol);
  return symbol;
}

/**
 * Record a settled trade `secondsAgo` before the start of the current minute.
 *
 * The reference point is the minute boundary rather than "now", so a test that
 * places several trades a few seconds apart cannot straddle two buckets just
 * because the suite happened to run near the end of a minute.
 */
function recordTrade(symbol, price, quantity, secondsAgo) {
  const minuteStart = Date.now() - (Date.now() % 60_000);
  const createdAt = new Date(minuteStart - secondsAgo * 1000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(
    `INSERT INTO spot_trades
       (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id, side,
        price, quantity, quote_quantity, maker_fee, taker_fee, created_at)
     VALUES (?, ?, 'm', 't', 'u1', 'u2', 'buy', ?, ?, ?, 0, 0, ?)`,
  ).run(generateId(), symbol, price, quantity, price * quantity, createdAt);
}

test('an unknown interval is rejected rather than defaulted', () => {
  assert.equal(intervalMs('7m'), null);
  assert.equal(intervalMs('1h'), 3_600_000);
  assert.deepEqual(candlesFor('BTC/RUSD', '7m', 10), []);
});

test('candles bucket trades by interval with open, high, low, close and volume', () => {
  const symbol = listPair('BTC', 'BTC/RUSD');
  // Three trades inside the last minute: open 100, high 120, low 90, close 110.
  recordTrade(symbol, 100, 1, 5);
  recordTrade(symbol, 120, 2, 3);
  recordTrade(symbol, 90, 1, 2);
  recordTrade(symbol, 110, 3, 1);

  const candles = candlesFor(symbol, '1m', 10);
  assert.equal(candles.length, 1);
  const [candle] = candles;
  assert.equal(candle.open, 100);
  assert.equal(candle.high, 120);
  assert.equal(candle.low, 90);
  assert.equal(candle.close, 110);
  assert.equal(candle.volume, 7);
  // The bucket start is aligned to the minute.
  assert.equal(candle.time % 60, 0);
});

test('trades in different intervals become separate candles, oldest first', () => {
  const symbol = listPair('ETH', 'ETH/RUSD');
  recordTrade(symbol, 200, 1, 3 * 60 + 10); // two whole minutes back
  recordTrade(symbol, 210, 1, 60 + 10); // previous minute
  recordTrade(symbol, 220, 1, 5); // this minute

  const candles = candlesFor(symbol, '1m', 10);
  assert.equal(candles.length, 3);
  assert.deepEqual(
    candles.map((c) => c.close),
    [200, 210, 220],
  );
  assert.ok(candles[0].time < candles[1].time);
  assert.ok(candles[1].time < candles[2].time);
});

test('the limit keeps the most recent candles', () => {
  const symbol = listPair('SOL', 'SOL/RUSD');
  for (let i = 1; i <= 5; i += 1) {
    recordTrade(symbol, 10 + i, 1, i * 60 + 5);
  }

  const candles = candlesFor(symbol, '1m', 2);
  assert.equal(candles.length, 2);
  // The two most recent minutes, oldest first: the trade five minutes back is
  // outside the window and is not reported.
  assert.deepEqual(
    candles.map((c) => c.close),
    [12, 11],
  );
});

test('a symbol with no trades returns an empty series, not a synthetic one', () => {
  listPair('XRP', 'XRP/RUSD');
  assert.deepEqual(candlesFor('XRP/RUSD', '1h', 100), []);
});

test('an invalid row is skipped rather than corrupting a candle', () => {
  const symbol = listPair('ADA', 'ADA/RUSD');
  recordTrade(symbol, 1, 1, 5);
  db.prepare(
    `INSERT INTO spot_trades
       (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id, side,
        price, quantity, quote_quantity, maker_fee, taker_fee, created_at)
     VALUES (?, ?, 'm', 't', 'u1', 'u2', 'buy', 0, 5, 0, 0, 0, datetime('now'))`,
  ).run(generateId(), symbol);

  const candles = candlesFor(symbol, '1m', 10);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].high, 1);
});

test('the positional form carries time, OHLC and volume in order', () => {
  const symbol = listPair('DOT', 'DOT/RUSD');
  recordTrade(symbol, 5, 2, 3);
  const [row] = candlesAsArrays(symbol, '1m', 10);
  assert.equal(row.length, 6);
  assert.equal(row[1], 5);
  assert.equal(row[5], 2);
});

test('a SQLite timestamp is read as UTC, not as local time', () => {
  // The schema stores `datetime('now')`, which is UTC with no zone marker.
  assert.equal(parseUtcTimestamp('2024-01-02 03:04:05'), Date.UTC(2024, 0, 2, 3, 4, 5));
  assert.equal(parseUtcTimestamp('not a date'), Number.NaN);
});

test('rolling24h excludes trades older than a day', () => {
  const symbol = listPair('LINK', 'LINK/RUSD');
  recordTrade(symbol, 50, 1, 60); // inside the window
  recordTrade(symbol, 60, 2, 60 * 60 * 25); // outside the window

  const stats = rolling24h(symbol);
  assert.ok(stats);
  assert.equal(stats.lastPrice, 50);
  assert.equal(stats.trades, 1);
  assert.equal(stats.volume, 1);
});

test('listedMarkets reports a null price for a market that has not traded', () => {
  listPair('AVAX', 'AVAX/RUSD');
  const market = listedMarkets().find((m) => m.symbol === 'AVAX/RUSD');
  assert.ok(market);
  assert.equal(market.lastPrice, null);
  assert.equal(market.volume24h, 0);
  assert.equal(market.priceChangePercent24h, null);
  assert.equal(market.baseCurrency, 'AVAX');
  assert.equal(market.quoteCurrency, 'RUSD');
});

test('listedMarkets carries the live statistics once a market trades', () => {
  const symbol = listPair('MATIC', 'MATIC/RUSD');
  recordTrade(symbol, 1, 10, 120);
  recordTrade(symbol, 2, 10, 5);

  const market = listedMarkets().find((m) => m.symbol === symbol);
  assert.ok(market);
  assert.equal(market.lastPrice, 2);
  assert.equal(market.volume24h, 20);
  assert.equal(market.trades24h, 2);
  assert.equal(market.priceChangePercent24h, 100);
});
