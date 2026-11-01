'use strict';
/**
 * Correctness tests for the realized-P&L arithmetic used by the portfolio
 * summary. Run through `npm run test:logic`, which compiles the TypeScript
 * module first. Uses Node's built-in test runner, so no test dependency is
 * needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { realizedPnl } = require('../../.test-build/pnl.js');

const NOW = Date.parse('2025-06-01T12:00:00Z');
const RECENT = '2025-06-01 11:00:00'; // one hour before NOW
const OLD = '2025-05-01 12:00:00'; // 31 days before NOW

const fill = (over) => ({
  pair_id: 'BTCUSDT',
  side: 'buy',
  quantity: 1,
  average_price: 100,
  fee: 0,
  created_at: OLD,
  ...over,
});

test('an empty ledger realizes nothing', () => {
  const r = realizedPnl([], NOW);
  assert.equal(r.total, 0);
  assert.equal(r.last24h, 0);
});

test('a round trip realizes the price difference net of both fees', () => {
  const r = realizedPnl(
    [
      fill({ side: 'buy', quantity: 1, average_price: 100, fee: 1 }),
      fill({ side: 'sell', quantity: 1, average_price: 110, fee: 1, created_at: RECENT }),
    ],
    NOW,
  );
  assert.equal(r.total, 8);
  assert.equal(r.last24h, 9);
});

test('a partial close realizes only the closed quantity', () => {
  const r = realizedPnl(
    [
      fill({ pair_id: 'X', side: 'buy', quantity: 2, average_price: 100 }),
      fill({ pair_id: 'X', side: 'sell', quantity: 1, average_price: 120 }),
    ],
    NOW,
  );
  assert.equal(r.total, 20);
});

test('multiple buys average into one cost basis', () => {
  const r = realizedPnl(
    [
      fill({ pair_id: 'Y', side: 'buy', quantity: 1, average_price: 100 }),
      fill({ pair_id: 'Y', side: 'buy', quantity: 1, average_price: 200 }),
      fill({ pair_id: 'Y', side: 'sell', quantity: 2, average_price: 180 }),
    ],
    NOW,
  );
  assert.equal(r.total, 60);
});

test('a short closed lower realizes a gain', () => {
  const r = realizedPnl(
    [
      fill({ pair_id: 'S', side: 'sell', quantity: 1, average_price: 100 }),
      fill({ pair_id: 'S', side: 'buy', quantity: 1, average_price: 90 }),
    ],
    NOW,
  );
  assert.equal(r.total, 10);
});

test('a short closed higher realizes a loss', () => {
  const r = realizedPnl(
    [
      fill({ pair_id: 'S', side: 'sell', quantity: 1, average_price: 100 }),
      fill({ pair_id: 'S', side: 'buy', quantity: 1, average_price: 130 }),
    ],
    NOW,
  );
  assert.equal(r.total, -30);
});

test('a fill larger than the position closes it and flips', () => {
  const r = realizedPnl(
    [
      fill({ pair_id: 'F', side: 'buy', quantity: 1, average_price: 100 }),
      fill({ pair_id: 'F', side: 'sell', quantity: 3, average_price: 110 }),
    ],
    NOW,
  );
  assert.equal(r.total, 10);
});

test('unusable rows are ignored instead of distorting the result', () => {
  const r = realizedPnl(
    [
      fill({ pair_id: 'Z', side: 'buy', quantity: 0, average_price: 100 }),
      fill({ pair_id: 'Z', side: 'buy', quantity: NaN, average_price: 100 }),
      fill({ pair_id: 'Z', side: 'buy', quantity: 1, average_price: -5 }),
      fill({ pair_id: 'Z', side: 'buy', quantity: 1, average_price: 100 }),
    ],
    NOW,
  );
  assert.equal(r.total, 0);
});

test('fees are a cost on the buy side too', () => {
  const r = realizedPnl(
    [
      fill({ pair_id: 'G', side: 'buy', quantity: 1, average_price: 100, fee: 2 }),
      fill({ pair_id: 'G', side: 'sell', quantity: 1, average_price: 100, fee: 3 }),
    ],
    NOW,
  );
  assert.equal(r.total, -5);
});

test('pairs are accounted independently', () => {
  const r = realizedPnl(
    [
      fill({ pair_id: 'A', side: 'buy', quantity: 1, average_price: 100 }),
      fill({ pair_id: 'A', side: 'sell', quantity: 1, average_price: 110 }),
      fill({ pair_id: 'B', side: 'buy', quantity: 1, average_price: 100 }),
      fill({ pair_id: 'B', side: 'sell', quantity: 1, average_price: 90 }),
    ],
    NOW,
  );
  assert.equal(r.total, 0);
});
