'use strict';
/**
 * Correctness tests for the TigerSwap launchpad and bot decision cores. The
 * cases assert that a bonding curve only ever rises, that an IDO allocates
 * exactly its supply, that an arbitrage search finds the profitable size, and
 * that each bot fails closed on bad input.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { AmmError } = require('../../.test-build/amm.js');
const launch = require('../../.test-build/launchpad.js');
const bots = require('../../.test-build/bots.js');
const orders = require('../../.test-build/orders.js');

const {
  bondingPrice,
  bondingBuyCost,
  bondingTokensForBudget,
  bondingSellProceeds,
  allocateIdo,
  lbpWeightAt,
  lbpSpotPrice,
} = launch;

const {
  gridLevels,
  findArbitrage,
  marketMakerQuote,
  needsRebalance,
  planRebalance,
  liquidationCandidates,
  dcaShouldBuy,
} = bots;

const {
  limitShouldTrigger,
  validateLimitOrder,
  dcaSlicesDue,
  twapChildren,
  twapAveragePrice,
  twammSliceAmount,
} = orders;

const linear = { kind: 'linear', basePrice: 1, slope: 0.001 };

test('a linear bonding curve price rises with supply', () => {
  assert.ok(bondingPrice(linear, 1000) > bondingPrice(linear, 0));
});

test('an exponential bonding curve price rises with supply', () => {
  const curve = { kind: 'exponential', basePrice: 1, slope: 1.001 };
  assert.ok(bondingPrice(curve, 1000, 1000) > bondingPrice(curve, 0, 1000));
});

test('buying cost is the integral of the price and inverts via budget', () => {
  const cost = bondingBuyCost(linear, 0, 100);
  const tokens = bondingTokensForBudget(linear, 0, cost);
  assert.ok(Math.abs(tokens - 100) < 1e-3, `expected ~100, got ${tokens}`);
});

test('a round trip through the curve with a fee returns less than was paid', () => {
  // Without a fee the area under the curve is identical either way; the fee is
  // what makes a buy-then-sell round trip strictly lossy.
  const cost = bondingBuyCost(linear, 0, 100, 1, 0.01);
  const proceeds = bondingSellProceeds(linear, 100, 100, 1, 0.01);
  assert.ok(proceeds < cost, `proceeds ${proceeds} should be below cost ${cost}`);
});

test('an IDO allocates exactly its supply', () => {
  const allocations = allocateIdo(
    [
      { userId: 'a', weight: 1 },
      { userId: 'b', weight: 3 },
    ],
    1000,
    2,
  );
  const total = allocations.reduce((acc, a) => acc + a.tokens, 0);
  assert.ok(Math.abs(total - 1000) < 1e-9);
  assert.ok(allocations[1].tokens > allocations[0].tokens);
});

test('an IDO refuses an empty participant list', () => {
  assert.throws(() => allocateIdo([], 1000, 1), AmmError);
});

test('an LBP weight falls from start to end', () => {
  const config = { startWeight: 0.9, endWeight: 0.1, startAt: 0, endAt: 1000 };
  assert.equal(lbpWeightAt(config, -1), 0.9);
  assert.equal(lbpWeightAt(config, 2000), 0.1);
  assert.ok(lbpWeightAt(config, 500) < 0.9 && lbpWeightAt(config, 500) > 0.1);
});

test('an LBP spot price is positive for a funded pool', () => {
  assert.ok(lbpSpotPrice(1_000_000, 100_000, 0.8) > 0);
});

test('grid levels are evenly spaced and bounded', () => {
  const levels = gridLevels({ lowerPrice: 100, upperPrice: 200, levels: 5, orderSize: 100 });
  assert.equal(levels.length, 5);
  assert.equal(levels[0], 100);
  assert.equal(levels[4], 200);
});

test('geometric grid levels follow a constant ratio', () => {
  const levels = gridLevels({ lowerPrice: 100, upperPrice: 400, levels: 3, orderSize: 100, spacing: 'geometric' });
  assert.ok(Math.abs(levels[1] / levels[0] - 2) < 1e-9);
});

test('arbitrage finds a profitable size between two mispriced pools', () => {
  // Buy pool gives 1.05 units per unit in; sell pool gives 1.0.
  const opportunity = findArbitrage(
    (amountIn) => amountIn * 1.05,
    (amountIn) => amountIn * 1.0,
    'cheap',
    'dear',
    'BTC',
    'RUSD',
    1000,
  );
  assert.ok(opportunity);
  assert.ok(opportunity.profit > 0);
});

test('arbitrage returns null when there is no profitable trade', () => {
  const opportunity = findArbitrage(
    (amountIn) => amountIn * 1.0,
    (amountIn) => amountIn * 0.99,
    'a',
    'b',
    'BTC',
    'RUSD',
    1000,
  );
  assert.equal(opportunity, null);
});

test('a market maker quotes a bid below and an ask above the mid', () => {
  const quote = marketMakerQuote(100, 0, 1000, { spread: 0.001, depth: 1000, rebalanceThreshold: 0.1 });
  assert.ok(quote.bidPrice < quote.midPrice);
  assert.ok(quote.askPrice > quote.midPrice);
});

test('inventory skew lowers both quotes for a base-heavy maker', () => {
  const neutral = marketMakerQuote(100, 0, 1000, { spread: 0.001, depth: 1000, rebalanceThreshold: 0.1 });
  const skewed = marketMakerQuote(100, 5, 1000, { spread: 0.001, depth: 1000, rebalanceThreshold: 0.1 });
  assert.ok(skewed.midPrice < neutral.midPrice);
});

test('rebalance triggers only past the threshold', () => {
  assert.equal(needsRebalance(5, 500, 100, 0.1), false);
  assert.equal(needsRebalance(5, 5, 100, 0.1), true);
});

test('a rebalance plan trades toward the target weights', () => {
  const trades = planRebalance(
    [
      { token: 'BTC', value: 1000 },
      { token: 'ETH', value: 0 },
    ],
    [
      { token: 'BTC', weight: 0.5 },
      { token: 'ETH', weight: 0.5 },
    ],
  );
  const btc = trades.find((t) => t.token === 'BTC');
  const eth = trades.find((t) => t.token === 'ETH');
  assert.ok(btc.deltaQuote < 0);
  assert.ok(eth.deltaQuote > 0);
});

test('liquidation candidates keep only positions below a health factor of 1', () => {
  const result = liquidationCandidates([
    { positionId: 'healthy', healthFactor: 1.5, bounty: 100 },
    { positionId: 'risky', healthFactor: 0.9, bounty: 10 },
    { positionId: 'worse', healthFactor: 0.5, bounty: 50 },
  ]);
  assert.deepEqual(
    result.map((c) => c.positionId),
    ['worse', 'risky'],
  );
});

test('a DCA bot buys only when the price is at or below its average', () => {
  const history = [100, 100, 100, 100];
  assert.equal(dcaShouldBuy(history, 4, 90), true);
  assert.equal(dcaShouldBuy(history, 4, 110), false);
  assert.equal(dcaShouldBuy([100], 4, 90), false);
});

test('a limit buy triggers at or below the limit and a sell at or above', () => {
  assert.equal(limitShouldTrigger({ side: 'buy', limitPrice: 100 }, 99), true);
  assert.equal(limitShouldTrigger({ side: 'buy', limitPrice: 100 }, 101), false);
  assert.equal(limitShouldTrigger({ side: 'sell', limitPrice: 100 }, 101), true);
});

test('limit order validation refuses a same-token pair', () => {
  assert.throws(
    () =>
      validateLimitOrder({
        poolId: 'p',
        side: 'buy',
        tokenIn: 'BTC',
        tokenOut: 'BTC',
        amountIn: 1,
        limitPrice: 100,
      }),
    AmmError,
  );
});

test('DCA slice count respects the plan total', () => {
  const plan = { poolId: 'p', tokenIn: 'RUSD', tokenOut: 'BTC', amountPerSlice: 100, frequency: 'daily', totalSlices: 3, startAt: 1000 };
  assert.equal(dcaSlicesDue(plan, 1000 + 24 * 60 * 60 * 1000 * 10), 3);
});

test('TWAP children sum exactly to the parent amount', () => {
  const children = twapChildren({
    poolId: 'p',
    tokenIn: 'RUSD',
    tokenOut: 'BTC',
    totalAmountIn: 10,
    slices: 3,
    intervalMs: 60_000,
    startAt: 1000,
  });
  const total = children.reduce((acc, c) => acc + c.amountIn, 0);
  assert.ok(Math.abs(total - 10) < 1e-12);
  assert.equal(children[0].releaseAt, 1000);
});

test('TWAP average price is the volume-weighted ratio', () => {
  const price = twapAveragePrice([
    { amountIn: 1, amountOut: 2 },
    { amountIn: 1, amountOut: 4 },
  ]);
  assert.ok(Math.abs(price - 3) < 1e-12);
});

test('TWAMM slice size is the amount scaled by the interval over the horizon', () => {
  assert.ok(Math.abs(twammSliceAmount(3600, 3600_000, 1000) - 1) < 1e-12);
});
