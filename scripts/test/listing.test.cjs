'use strict';
/**
 * Correctness tests for spot-market listing validation. Run through
 * `npm run test:logic`, which compiles the TypeScript module first.
 *
 * The cases below are the ones that would otherwise reach `trading_pairs` and
 * make a listed market untradable: a zero tick size, inverted bounds, a fee
 * that pays the trader, and a symbol whose legs disagree with its asset codes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePairInput } = require('../../.test-build/listing.js');

const valid = {
  symbol: 'BTC/USDT',
  tickSize: 0.01,
  minPrice: 0.01,
  maxPrice: 1000000,
  minQuantity: 0.00001,
  maxQuantity: 100000,
  minNotional: 1,
  makerFee: 0.001,
  takerFee: 0.001,
};

test('a well-formed listing is accepted and normalized', () => {
  const result = validatePairInput(valid);
  assert.ok('pair' in result, JSON.stringify(result));
  assert.equal(result.pair.symbol, 'BTC/USDT');
  assert.equal(result.pair.baseCurrency, 'BTC');
  assert.equal(result.pair.quoteCurrency, 'USDT');
  assert.equal(result.pair.status, 'active');
});

test('lowercase symbols and asset codes are normalized, not rejected', () => {
  const result = validatePairInput({ ...valid, symbol: 'eth/usdt' });
  assert.ok('pair' in result);
  assert.equal(result.pair.symbol, 'ETH/USDT');
});

test('a symbol without a quote leg is rejected', () => {
  const result = validatePairInput({ ...valid, symbol: 'BTCUSDT' });
  assert.ok('error' in result);
});

test('a symbol with equal legs is rejected', () => {
  const result = validatePairInput({ ...valid, symbol: 'BTC/BTC' });
  assert.ok('error' in result);
});

test('asset codes that disagree with the symbol are rejected', () => {
  const result = validatePairInput({ ...valid, baseCurrency: 'ETH' });
  assert.ok('error' in result);
});

test('a zero tick size is rejected', () => {
  const result = validatePairInput({ ...valid, tickSize: 0 });
  assert.ok('error' in result);
});

test('a negative tick size is rejected', () => {
  const result = validatePairInput({ ...valid, tickSize: -0.01 });
  assert.ok('error' in result);
});

test('inverted price bounds are rejected', () => {
  const result = validatePairInput({ ...valid, minPrice: 1000, maxPrice: 1 });
  assert.ok('error' in result);
});

test('equal price bounds are rejected', () => {
  const result = validatePairInput({ ...valid, minPrice: 5, maxPrice: 5 });
  assert.ok('error' in result);
});

test('inverted quantity bounds are rejected', () => {
  const result = validatePairInput({ ...valid, minQuantity: 10, maxQuantity: 1 });
  assert.ok('error' in result);
});

test('a NaN price is rejected rather than persisted as null', () => {
  const result = validatePairInput({ ...valid, maxPrice: NaN });
  assert.ok('error' in result);
});

test('an infinite quantity is rejected', () => {
  const result = validatePairInput({ ...valid, maxQuantity: Infinity });
  assert.ok('error' in result);
});

test('a fee of 1 is rejected: it would seize the whole notional', () => {
  assert.ok('error' in validatePairInput({ ...valid, makerFee: 1 }));
  assert.ok('error' in validatePairInput({ ...valid, takerFee: 1 }));
});

test('a negative fee is rejected: it would pay the trader', () => {
  assert.ok('error' in validatePairInput({ ...valid, makerFee: -0.001 }));
});

test('an unknown status is rejected', () => {
  assert.ok('error' in validatePairInput({ ...valid, status: 'enabled' }));
});

test('paused and delisting are accepted statuses', () => {
  assert.ok('pair' in validatePairInput({ ...valid, status: 'paused' }));
  assert.ok('pair' in validatePairInput({ ...valid, status: 'delisting' }));
});

test('a missing minNotional defaults to one rather than zero', () => {
  const { minNotional, ...rest } = valid;
  const result = validatePairInput(rest);
  assert.ok('pair' in result);
  assert.equal(result.pair.minNotional, 1);
});
