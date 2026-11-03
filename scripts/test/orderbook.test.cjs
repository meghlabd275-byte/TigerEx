'use strict';
/**
 * Correctness tests for the price-time priority order book.
 *
 * The cases that matter are the ones that would corrupt the book or a fill:
 * a crossing limit taking the right price, time priority at an equal price,
 * post-only rejection, fill-or-kill refusal, a market order never resting,
 * and a non-finite price being refused rather than matched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { OrderBook, fillFee, tradeFees } = require('../../.test-build/orderbook.js');

function book() {
  return new OrderBook('BTC/USDT');
}

test('a crossing limit order fills at the resting maker price', () => {
  const b = book();
  b.match({ orderId: 'm1', userId: 'maker', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  const result = b.match({ orderId: 't1', userId: 'taker', side: 'buy', type: 'limit', price: 105, quantity: 1 });
  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].price, 100); // taker gets the maker's price, not its own
  assert.equal(result.fills[0].quantity, 1);
  assert.equal(result.resting, 0);
});

test('an order that does not cross rests on the book', () => {
  const b = book();
  const result = b.match({ orderId: 'a', userId: 'u', side: 'buy', type: 'limit', price: 99, quantity: 2 });
  assert.equal(result.fills.length, 0);
  assert.equal(result.resting, 2);
  assert.equal(b.bestBid(), 99);
});

test('time priority is preserved at an equal price', () => {
  const b = book();
  b.match({ orderId: 'first', userId: 'u1', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  b.match({ orderId: 'second', userId: 'u2', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  const result = b.match({ orderId: 't', userId: 'taker', side: 'buy', type: 'limit', price: 100, quantity: 2 });
  assert.equal(result.fills[0].makerOrderId, 'first');
  assert.equal(result.fills[1].makerOrderId, 'second');
});

test('price priority beats arrival: a better ask fills first', () => {
  const b = book();
  b.match({ orderId: 'high', userId: 'u1', side: 'sell', type: 'limit', price: 101, quantity: 1 });
  b.match({ orderId: 'low', userId: 'u2', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  const result = b.match({ orderId: 't', userId: 'taker', side: 'buy', type: 'limit', price: 101, quantity: 1 });
  assert.equal(result.fills[0].makerOrderId, 'low');
  assert.equal(b.bestAsk(), 101);
});

test('a partial fill leaves the remainder resting', () => {
  const b = book();
  b.match({ orderId: 'm', userId: 'maker', side: 'sell', type: 'limit', price: 100, quantity: 5 });
  const result = b.match({ orderId: 't', userId: 'taker', side: 'buy', type: 'limit', price: 100, quantity: 2 });
  assert.equal(result.fills[0].quantity, 2);
  assert.equal(result.resting, 0);
  assert.equal(b.bestAsk(), 100);
  assert.equal(b.depth('sell')[0].quantity, 3);
});

test('a post-only order that would cross is rejected', () => {
  const b = book();
  b.match({ orderId: 'm', userId: 'maker', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  const result = b.match({
    orderId: 'p', userId: 'taker', side: 'buy', type: 'limit', price: 100, quantity: 1, postOnly: true,
  });
  assert.ok(result.rejected);
  assert.equal(result.fills.length, 0);
  assert.equal(b.bestAsk(), 100); // the book is untouched
});

test('a fill-or-kill order is refused when the book is too thin', () => {
  const b = book();
  b.match({ orderId: 'm', userId: 'maker', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  const result = b.match({
    orderId: 'f', userId: 'taker', side: 'buy', type: 'limit', price: 100, quantity: 2, timeInForce: 'FOK',
  });
  assert.ok(result.rejected);
  assert.equal(result.fills.length, 0);
  assert.equal(b.depth('sell')[0].quantity, 1); // untouched
});

test('a fill-or-kill order that can fill whole executes', () => {
  const b = book();
  b.match({ orderId: 'm', userId: 'maker', side: 'sell', type: 'limit', price: 100, quantity: 3 });
  const result = b.match({
    orderId: 'f', userId: 'taker', side: 'buy', type: 'limit', price: 100, quantity: 2, timeInForce: 'FOK',
  });
  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].quantity, 2);
});

test('an immediate-or-cancel remainder is discarded, not rested', () => {
  const b = book();
  b.match({ orderId: 'm', userId: 'maker', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  const result = b.match({
    orderId: 'i', userId: 'taker', side: 'buy', type: 'limit', price: 100, quantity: 3, timeInForce: 'IOC',
  });
  assert.equal(result.fills[0].quantity, 1);
  assert.equal(result.unfilled, 2);
  assert.equal(result.resting, 0);
  assert.equal(b.bestBid(), null);
});

test('a market order never rests on the book', () => {
  const b = book();
  b.match({ orderId: 'm', userId: 'maker', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  const result = b.match({ orderId: 'mk', userId: 'taker', side: 'buy', type: 'market', quantity: 5 });
  assert.equal(result.fills[0].quantity, 1);
  assert.equal(result.unfilled, 4);
  assert.equal(result.resting, 0);
  assert.equal(b.bestBid(), null);
});

test('a non-finite quantity is refused rather than matched', () => {
  const b = book();
  const result = b.match({ orderId: 'x', userId: 'u', side: 'buy', type: 'limit', price: 100, quantity: NaN });
  assert.ok(result.rejected);
});

test('a limit order without a price is refused', () => {
  const b = book();
  const result = b.match({ orderId: 'x', userId: 'u', side: 'buy', type: 'limit', quantity: 1 });
  assert.ok(result.rejected);
});

test('a zero or negative price is refused', () => {
  const b = book();
  assert.ok(b.match({ orderId: 'x', userId: 'u', side: 'buy', type: 'limit', price: 0, quantity: 1 }).rejected);
  assert.ok(b.match({ orderId: 'y', userId: 'u', side: 'buy', type: 'limit', price: -5, quantity: 1 }).rejected);
});

test('cancelling returns the open quantity and removes the level', () => {
  const b = book();
  b.match({ orderId: 'a', userId: 'u', side: 'buy', type: 'limit', price: 99, quantity: 2 });
  assert.equal(b.cancel('a'), 2);
  assert.equal(b.bestBid(), null);
  assert.equal(b.cancel('a'), 0); // cancelling twice is harmless
});

test('depth aggregates quantity at each price level', () => {
  const b = book();
  b.match({ orderId: 'a', userId: 'u1', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  b.match({ orderId: 'b', userId: 'u2', side: 'sell', type: 'limit', price: 100, quantity: 2 });
  b.match({ orderId: 'c', userId: 'u3', side: 'sell', type: 'limit', price: 101, quantity: 4 });
  const depth = b.depth('sell');
  assert.equal(depth[0].price, 100);
  assert.equal(depth[0].quantity, 3);
  assert.equal(depth[1].price, 101);
  assert.equal(depth[1].quantity, 4);
});

test('self-trade is reported with both counterparties so the caller can prevent it', () => {
  const b = book();
  b.match({ orderId: 'm', userId: 'same', side: 'sell', type: 'limit', price: 100, quantity: 1 });
  const result = b.match({ orderId: 't', userId: 'same', side: 'buy', type: 'limit', price: 100, quantity: 1 });
  assert.equal(result.fills[0].makerUserId, 'same');
  assert.equal(result.fills[0].takerUserId, 'same');
});

test('fill fee is notional times the rate, and refuses unusable input', () => {
  assert.equal(fillFee(100, 2, 0.001), 0.2);
  assert.equal(fillFee(NaN, 2, 0.001), 0);
  assert.equal(fillFee(100, 0, 0.001), 0);
  assert.equal(fillFee(100, 2, -1), 0);
});

test('trade fees split maker and taker rates', () => {
  const fees = tradeFees(100, 1, 0.0002, 0.0005);
  assert.ok(Math.abs(fees.makerFee - 0.02) < 1e-12);
  assert.ok(Math.abs(fees.takerFee - 0.05) < 1e-12);
});
