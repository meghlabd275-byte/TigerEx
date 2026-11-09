'use strict';
/**
 * Correctness tests for the TigerSwap router and aggregator. These assert the
 * behaviour the swap endpoint relies on: a direct pool route is found, a
 * multi-hop route is preferred when it pays more, a split across two pools
 * beats either alone, and an unconnected pair fails closed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { AmmError } = require('../../.test-build/amm.js');
const {
  poolSupports,
  quotePool,
  findRoutes,
  splitRoutes,
  aggregate,
} = require('../../.test-build/router.js');

function v2(poolId, a, b, reserveA, reserveB, fee = 0.003) {
  return { poolId, definition: { kind: 'v2', reserves: { [a]: reserveA, [b]: reserveB }, fee } };
}

test('poolSupports reports both directions and rejects unrelated tokens', () => {
  const pool = v2('p1', 'BTC', 'RUSD', 10, 100_000);
  assert.ok(poolSupports(pool, 'BTC', 'RUSD'));
  assert.ok(poolSupports(pool, 'RUSD', 'BTC'));
  assert.ok(!poolSupports(pool, 'BTC', 'ETH'));
  assert.ok(!poolSupports(pool, 'BTC', 'BTC'));
});

test('quotePool prices a direct V2 swap', () => {
  const pool = v2('p1', 'BTC', 'RUSD', 10, 100_000);
  const hop = quotePool(pool, 'BTC', 'RUSD', 0.1);
  assert.equal(hop.tokenIn, 'BTC');
  assert.ok(hop.amountOut > 0);
});

test('quotePool fails closed on a pair the pool does not hold', () => {
  const pool = v2('p1', 'BTC', 'RUSD', 10, 100_000);
  assert.throws(() => quotePool(pool, 'BTC', 'ETH', 1), AmmError);
});

test('findRoutes returns a direct route for a two-token graph', () => {
  const pools = [v2('p1', 'BTC', 'RUSD', 10, 100_000)];
  const routes = findRoutes(pools, 'BTC', 'RUSD', 0.1);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].hops.length, 1);
});

test('findRoutes prefers the cheaper multi-hop route when it pays more', () => {
  // BTC/RUSD direct pool is expensive; BTC/ETH and ETH/RUSD are both deep.
  const pools = [
    v2('direct', 'BTC', 'RUSD', 1, 10_000, 0.3),
    v2('btc-eth', 'BTC', 'ETH', 100, 2000),
    v2('eth-rusd', 'ETH', 'RUSD', 2000, 4_000_000),
  ];
  const routes = findRoutes(pools, 'BTC', 'RUSD', 0.5, { maxHops: 3 });
  assert.ok(routes.length >= 1);
  // The two-hop path should win on output for this size.
  assert.ok(routes[0].hops.length === 2, `best route had ${routes[0].hops.length} hops`);
});

test('findRoutes fails closed when no path connects the tokens', () => {
  const pools = [v2('p1', 'BTC', 'RUSD', 10, 100_000)];
  const routes = findRoutes(pools, 'SOL', 'RUSD', 1);
  assert.equal(routes.length, 0);
});

test('splitRoutes across two identical pools beats a single pool', () => {
  const pools = [v2('p1', 'BTC', 'RUSD', 10, 100_000), v2('p2', 'BTC', 'RUSD', 10, 100_000)];
  const routes = findRoutes(pools, 'BTC', 'RUSD', 2, { maxRoutes: 2 });
  assert.ok(routes.length >= 2);
  const single = routes[0].amountOut;
  const split = splitRoutes(pools, 'BTC', 'RUSD', 2, routes);
  assert.ok(split.amountOut >= single, `split ${split.amountOut} should beat single ${single}`);
});

test('aggregate returns a usable quote and never a fabricated one', () => {
  const pools = [v2('p1', 'BTC', 'RUSD', 10, 100_000)];
  const quote = aggregate(pools, 'BTC', 'RUSD', 0.1);
  assert.ok(quote.amountOut > 0);
  assert.equal(quote.amountIn, 0.1);
  assert.ok(quote.effectivePrice > 0);
});

test('aggregate fails closed on a disconnected pair', () => {
  const pools = [v2('p1', 'BTC', 'RUSD', 10, 100_000)];
  assert.throws(() => aggregate(pools, 'BTC', 'SOL', 0.1), AmmError);
});

test('aggregate refuses a non-positive amount', () => {
  const pools = [v2('p1', 'BTC', 'RUSD', 10, 100_000)];
  assert.throws(() => aggregate(pools, 'BTC', 'RUSD', 0), AmmError);
});
