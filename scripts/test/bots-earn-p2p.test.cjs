'use strict';
/**
 * Tests for bots, earn products, P2P escrow, leveraged ETFs, copy trading and
 * the request-level security guards.
 *
 * Each module is a rule the exchange enforces, so the tests assert the refusal
 * cases: an inverted grid, an uncapped martingale, an escrow released without
 * payment, a token that goes negative, a copy sized past its cap.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const bots = require('../../.test-build/strategies.js');
const earn = require('../../.test-build/products.js');
const p2p = require('../../.test-build/escrow.js');
const etf = require('../../.test-build/etf.js');
const copy = require('../../.test-build/copy.js');
const guards = require('../../.test-build/guards.js');

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

test('a grid ladder is ordered and spans the range', () => {
  const levels = bots.gridLevels({ lowerPrice: 100, upperPrice: 200, grids: 4 });
  assert.ok(Array.isArray(levels));
  assert.equal(levels.length, 5);
  assert.equal(levels[0].price, 100);
  assert.equal(levels[4].price, 200);
  assert.equal(levels[0].side, 'buy');
  assert.equal(levels[4].side, 'sell');
});

test('an inverted grid range is refused', () => {
  assert.ok('error' in bots.gridLevels({ lowerPrice: 200, upperPrice: 100, grids: 4 }));
  assert.ok('error' in bots.gridLevels({ lowerPrice: 100, upperPrice: 100, grids: 4 }));
});

test('a grid with fewer than two levels is refused', () => {
  assert.ok('error' in bots.gridLevels({ lowerPrice: 100, upperPrice: 200, grids: 1 }));
});

test('a geometric grid stays inside its bounds and increases', () => {
  const levels = bots.gridLevels({ lowerPrice: 100, upperPrice: 200, grids: 4, geometric: true });
  assert.ok(Array.isArray(levels));
  assert.ok(levels[0].price >= 100 - 1e-9);
  assert.ok(levels[4].price <= 200 + 1e-9);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(levels[i].price > levels[i - 1].price);
  }
});

test('the grid signal buys below the ladder and sells above it', () => {
  const levels = bots.gridLevels({ lowerPrice: 100, upperPrice: 200, grids: 4 });
  assert.equal(bots.gridSignal(levels, 90).side, 'buy');
  assert.equal(bots.gridSignal(levels, 210).side, 'sell');
});

test('the DCA amount grows with the multiplier and is capped', () => {
  const amount = bots.dcaAmount({ amount: 100, intervalNs: 1, multiplier: 2 }, 3);
  assert.equal(amount, 800);
  const capped = bots.dcaAmount({ amount: 100, intervalNs: 1, multiplier: 2, maxAmount: 500 }, 3);
  assert.equal(capped, 500);
});

test('a DCA multiplier below one is refused', () => {
  assert.ok('error' in bots.dcaAmount({ amount: 100, intervalNs: 1, multiplier: 0.5 }, 0));
  assert.ok('error' in bots.dcaAmount({ amount: 0, intervalNs: 1 }, 0));
});

test('TWAP slices sum exactly to the parent quantity', () => {
  const slices = bots.twapSlices({ totalQuantity: 10, slices: 3 });
  assert.ok(Array.isArray(slices));
  assert.equal(slices.length, 3);
  assert.ok(Math.abs(slices.reduce((a, b) => a + b, 0) - 10) < 1e-12);
});

test('a TWAP with fewer than two slices or a non-positive quantity is refused', () => {
  assert.ok('error' in bots.twapSlices({ totalQuantity: 10, slices: 1 }));
  assert.ok('error' in bots.twapSlices({ totalQuantity: 0, slices: 3 }));
});

test('rebalance orders move the portfolio toward its targets', () => {
  const orders = bots.rebalanceOrders({
    targets: { BTC: 0.5, ETH: 0.5 },
    holdings: { BTC: 1, ETH: 0 },
    prices: { BTC: 100, ETH: 100 },
  });
  assert.ok(Array.isArray(orders));
  const eth = orders.find((o) => o.asset === 'ETH');
  assert.equal(eth.side, 'buy');
  assert.ok(Math.abs(eth.notional - 50) < 1e-9);
});

test('rebalance weights that do not sum to one are refused', () => {
  const result = bots.rebalanceOrders({
    targets: { BTC: 0.5, ETH: 0.2 },
    holdings: { BTC: 1, ETH: 1 },
    prices: { BTC: 100, ETH: 100 },
  });
  assert.ok('error' in result);
});

test('a rebalance with a missing price is refused rather than valued at zero', () => {
  const result = bots.rebalanceOrders({
    targets: { BTC: 1 },
    holdings: { BTC: 1 },
    prices: {},
  });
  assert.ok('error' in result);
});

test('market maker quotes bracket the mid with a positive spread', () => {
  const quotes = bots.marketMakerQuotes(100, { spread: 0.01, depthPerSide: 10_000, inventory: 0, maxInventory: 10 });
  assert.ok(!('error' in quotes));
  assert.ok(quotes.bid < 100);
  assert.ok(quotes.ask > 100);
});

test('a long inventory skews the quotes down so the bot sells down', () => {
  const flat = bots.marketMakerQuotes(100, { spread: 0.01, depthPerSide: 1000, inventory: 0, maxInventory: 10 });
  const long = bots.marketMakerQuotes(100, { spread: 0.01, depthPerSide: 1000, inventory: 10, maxInventory: 10 });
  assert.ok(long.bid < flat.bid);
  assert.ok(long.ask < flat.ask);
});

test('the market maker refuses a spread outside (0, 1)', () => {
  assert.ok('error' in bots.marketMakerQuotes(100, { spread: 0, depthPerSide: 1, inventory: 0, maxInventory: 1 }));
  assert.ok('error' in bots.marketMakerQuotes(100, { spread: 2, depthPerSide: 1, inventory: 0, maxInventory: 1 }));
});

test('arbitrage edge is positive only when basis and funding beat the fees', () => {
  const good = bots.arbitrageEdge({ spotPrice: 100, futuresPrice: 102, fundingApr: 0.1, holdDays: 30, feeRate: 0.001 });
  assert.ok(!('error' in good));
  assert.equal(good.profitable, true);
  const bad = bots.arbitrageEdge({ spotPrice: 100, futuresPrice: 100, fundingApr: -0.1, holdDays: 30, feeRate: 0.01 });
  assert.equal(bad.profitable, false);
});

// ---------------------------------------------------------------------------
// Earn
// ---------------------------------------------------------------------------

test('simple accrual is principal times APR over the period', () => {
  const yearNs = 365 * 24 * 60 * 60 * 1e9;
  assert.ok(Math.abs(earn.accrueSimple(1000, 0.1, yearNs) - 100) < 1e-6);
});

test('compounded accrual exceeds simple accrual over the same period', () => {
  const yearNs = 365 * 24 * 60 * 60 * 1e9;
  const simple = earn.accrueSimple(1000, 0.15, yearNs);
  const compounded = earn.accrueCompounded(1000, 0.15, yearNs);
  assert.ok(compounded > simple);
});

test('accrual is zero for a non-positive principal, APR or period', () => {
  assert.equal(earn.accrueSimple(0, 0.1, 1e9), 0);
  assert.equal(earn.accrueSimple(1000, 0, 1e9), 0);
  assert.equal(earn.accrueSimple(1000, 0.1, 0), 0);
  assert.equal(earn.accrueCompounded(NaN, 0.1, 1e9), 0);
});

test('a locked product is redeemable only after its term', () => {
  const dayNs = 24 * 60 * 60 * 1e9;
  assert.equal(earn.lockedRedeemable(0, 30, 29 * dayNs), false);
  assert.equal(earn.lockedRedeemable(0, 30, 31 * dayNs), true);
});

test('only the vault product type compounds', () => {
  assert.equal(earn.productCompounds('vault'), true);
  assert.equal(earn.productCompounds('VAULT'), true);
  assert.equal(earn.productCompounds('flexible'), false);
  assert.equal(earn.productCompounds('locked'), false);
  assert.equal(earn.productCompounds(null), false);
});

test('a vault subscription accrues compounding interest, a flexible one simple', () => {
  const yearNs = 365 * 24 * 60 * 60 * 1e9;
  const vault = earn.accrueForProduct(1000, 0.15, yearNs, 'vault');
  const flexible = earn.accrueForProduct(1000, 0.15, yearNs, 'flexible');
  assert.ok(vault > flexible, `vault ${vault} should exceed simple ${flexible}`);
  assert.ok(Math.abs(flexible - 150) < 1e-6);
  // Continuous compounding: 1000 * (e^0.15 - 1).
  assert.ok(Math.abs(vault - 1000 * (Math.exp(0.15) - 1)) < 1e-6);
});

test('dual investment converts at the strike when the condition is met', () => {
  const converted = earn.settleDualInvestment({
    amount: 1000, apy: 0.2, strike: 100, settlementPrice: 90, direction: 'buy_low', termDays: 7,
  });
  assert.ok(!('error' in converted));
  assert.equal(converted.settlementAsset, 'base');
  const kept = earn.settleDualInvestment({
    amount: 1000, apy: 0.2, strike: 100, settlementPrice: 110, direction: 'buy_low', termDays: 7,
  });
  assert.equal(kept.settlementAsset, 'quote');
  assert.ok(kept.reward > 0);
});

test('shark fin pays the minimum outside the range and the maximum inside', () => {
  const inside = earn.settleSharkFin({ amount: 1000, minYield: 0.01, maxYield: 0.2, lowerBound: 90, upperBound: 110, settlementPrice: 100 });
  assert.ok(!('error' in inside));
  assert.equal(inside.inRange, true);
  assert.equal(inside.payout, 1200);
  const outside = earn.settleSharkFin({ amount: 1000, minYield: 0.01, maxYield: 0.2, lowerBound: 90, upperBound: 110, settlementPrice: 130 });
  assert.equal(outside.inRange, false);
  assert.equal(outside.payout, 1010);
});

test('a shark fin never returns less than the principal', () => {
  const result = earn.settleSharkFin({ amount: 1000, minYield: 0, maxYield: 0.2, lowerBound: 90, upperBound: 110, settlementPrice: 1 });
  assert.ok(result.payout >= 1000);
});

test('an inverted shark fin range is refused', () => {
  assert.ok('error' in earn.settleSharkFin({ amount: 1000, minYield: 0.01, maxYield: 0.2, lowerBound: 110, upperBound: 90, settlementPrice: 100 }));
  assert.ok('error' in earn.settleSharkFin({ amount: 1000, minYield: 0.5, maxYield: 0.1, lowerBound: 90, upperBound: 110, settlementPrice: 100 }));
});

test('dual-investment terms are validated before a product can be listed', () => {
  const ok = earn.validateDualTerms({ underlying: 'btc', strike: 40000, direction: 'buy_low' });
  assert.ok(!('error' in ok));
  assert.equal(ok.underlying, 'BTC');
  assert.equal(ok.direction, 'buy_low');
  assert.ok('error' in earn.validateDualTerms({ underlying: 'BTC', strike: 0, direction: 'buy_low' }));
  assert.ok('error' in earn.validateDualTerms({ underlying: 'BTC', strike: 1, direction: 'sideways' }));
  assert.ok('error' in earn.validateDualTerms({ strike: 1, direction: 'buy_low' }));
});

test('shark-fin terms are validated before a product can be listed', () => {
  const ok = earn.validateSharkTerms({ underlying: 'ETH', lowerBound: 90, upperBound: 110, minYield: 0.01, maxYield: 0.2 });
  assert.ok(!('error' in ok));
  assert.ok('error' in earn.validateSharkTerms({ underlying: 'ETH', lowerBound: 110, upperBound: 90, minYield: 0.01, maxYield: 0.2 }));
  assert.ok('error' in earn.validateSharkTerms({ underlying: 'ETH', lowerBound: 90, upperBound: 110, minYield: 0.5, maxYield: 0.1 }));
});

test('launchpool rewards split by stake weight and refuse a zero total', () => {
  assert.equal(earn.launchpoolReward(50, 100, 1000), 500);
  assert.equal(earn.launchpoolReward(50, 0, 1000), 0);
});

// ---------------------------------------------------------------------------
// P2P escrow
// ---------------------------------------------------------------------------

test('a P2P order cannot be released before payment', () => {
  assert.equal(p2p.transition('pending', 'release').error !== undefined, true);
  assert.equal(p2p.transition('pending', 'pay').status, 'paid');
  assert.equal(p2p.transition('paid', 'release').status, 'released');
});

test('a released order cannot transition again', () => {
  assert.ok(p2p.transition('released', 'cancel').error);
  assert.ok(p2p.transition('cancelled', 'pay').error);
});

test('a dispute can be resolved from either live state', () => {
  assert.equal(p2p.transition('pending', 'dispute').status, 'disputed');
  assert.equal(p2p.transition('disputed', 'resolve').status, 'resolved');
});

test('the fiat amount respects the currency precision', () => {
  assert.equal(p2p.fiatAmount(1, 100, 2), 100);
  assert.equal(p2p.fiatAmount(0.123456, 100, 2), 12.35);
  assert.ok('error' in p2p.fiatAmount(0, 100));
  assert.ok('error' in p2p.fiatAmount(1, -100));
});

test('a trade outside the offer limits is refused', () => {
  assert.equal(p2p.withinOfferLimits(50, 10, 100, 100), true);
  assert.equal(p2p.withinOfferLimits(5, 10, 100, 100), false);
  assert.equal(p2p.withinOfferLimits(150, 10, 100, 100), false);
  assert.equal(p2p.withinOfferLimits(50, 10, 100, 20), false);
});

test('a dispute split always returns the whole escrow', () => {
  const split = p2p.disputeSplit(100, 0.7);
  assert.equal(split.buyerAmount, 70);
  assert.equal(split.sellerAmount, 30);
  const clamped = p2p.disputeSplit(100, 5);
  assert.equal(clamped.buyerAmount, 100);
  assert.equal(clamped.sellerAmount, 0);
});

// ---------------------------------------------------------------------------
// Leveraged ETF
// ---------------------------------------------------------------------------

test('a 3x long token returns three times the underlying move', () => {
  const nav = etf.applyMove({ nav: 100, leverage: 3, lastRebalancePrice: 100, lastRebalanceNs: 0 }, 110);
  assert.ok(Math.abs(nav - 130) < 1e-9);
});

test('an inverse token moves against the underlying', () => {
  const nav = etf.applyMove({ nav: 100, leverage: -1, lastRebalancePrice: 100, lastRebalanceNs: 0 }, 110);
  assert.ok(Math.abs(nav - 90) < 1e-9);
});

test('a leveraged token cannot go negative', () => {
  const nav = etf.applyMove({ nav: 100, leverage: 3, lastRebalancePrice: 100, lastRebalanceNs: 0 }, 0.1);
  assert.equal(nav, 0);
});

test('a zero leverage or non-positive NAV is refused', () => {
  assert.ok('error' in etf.applyMove({ nav: 100, leverage: 0, lastRebalancePrice: 100, lastRebalanceNs: 0 }, 110));
  assert.ok('error' in etf.applyMove({ nav: 0, leverage: 3, lastRebalancePrice: 100, lastRebalanceNs: 0 }, 110));
});

test('a rebalance is due after a day and not before', () => {
  const dayNs = 24 * 60 * 60 * 1e9;
  const state = { nav: 100, leverage: 3, lastRebalancePrice: 100, lastRebalanceNs: 0 };
  assert.equal(etf.rebalanceDue(state, 100, dayNs - 1), false);
  assert.equal(etf.rebalanceDue(state, 100, dayNs + 1), true);
});

test('the management fee only ever reduces NAV and is zero for no elapsed time', () => {
  assert.equal(etf.managementFee(1000, 0), 0);
  const yearNs = 365 * 24 * 60 * 60 * 1e9;
  assert.ok(etf.managementFee(1000, yearNs) > 0);
});

test('a deposit buys tokens at NAV and redemption returns the NAV less the exit fee', () => {
  assert.equal(etf.tokensForDeposit(100, 10), 10);
  assert.equal(etf.redemptionValue(10, 10, 0.01), 99);
  assert.equal(etf.tokensForDeposit(100, 0), 0);
});

// ---------------------------------------------------------------------------
// Copy trading
// ---------------------------------------------------------------------------

test('a fixed-size copy mirrors a fixed notional', () => {
  const order = copy.copyOrder(
    { symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 5, leaderEquity: 1000 },
    { mode: 'fixed', fixedAmount: 200 },
    10_000,
  );
  assert.ok(order && !('error' in order));
  assert.equal(order.notional, 200);
  assert.equal(order.quantity, 2);
});

test('a ratio copy scales by the follower equity and the ratio', () => {
  const order = copy.copyOrder(
    { symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 1, leaderEquity: 1000 },
    { mode: 'ratio', ratio: 1 },
    500,
  );
  assert.ok(order && !('error' in order));
  // leader used 10% of equity; follower mirrors 10% of 500 = 50
  assert.ok(Math.abs(order.notional - 50) < 1e-9);
});

test('a copy is capped at the follower maximum', () => {
  const order = copy.copyOrder(
    { symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 100, leaderEquity: 1000 },
    { mode: 'ratio', ratio: 1, maxPosition: 50 },
    10_000,
  );
  assert.ok(order && !('error' in order));
  assert.equal(order.notional, 50);
});

test('a copy with an unusable config is an error', () => {
  assert.ok('error' in copy.copyOrder(
    { symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 1, leaderEquity: 1000 },
    { mode: 'fixed' },
    1000,
  ));
  assert.ok('error' in copy.copyOrder(
    { symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 1, leaderEquity: 0 },
    { mode: 'ratio', ratio: 1 },
    1000,
  ));
});

test('a loss owes the leader no profit share', () => {
  assert.equal(copy.profitShare(-100, 0.1), 0);
  assert.equal(copy.profitShare(100, 0.1), 10);
});

test('leader metrics are computed from real trades and an empty history is zero', () => {
  const metrics = copy.leaderMetrics([{ profit: 100 }, { profit: -50 }, { profit: 50 }], 1000);
  assert.equal(metrics.totalProfit, 100);
  assert.ok(Math.abs(metrics.roi - 0.1) < 1e-9);
  assert.ok(Math.abs(metrics.winRate - 2 / 3) < 1e-9);
  assert.deepEqual(copy.leaderMetrics([], 1000), { totalProfit: 0, roi: 0, winRate: 0, trades: 0 });
});

// ---------------------------------------------------------------------------
// Security guards
// ---------------------------------------------------------------------------

test('constant-time comparison matches equal strings and rejects others', () => {
  assert.equal(guards.constantTimeEqual('abc', 'abc'), true);
  assert.equal(guards.constantTimeEqual('abc', 'abd'), false);
  assert.equal(guards.constantTimeEqual('abc', 'abcd'), false);
});

test('the rate limiter allows up to the limit then refuses', () => {
  let state = null;
  for (let i = 0; i < 3; i += 1) {
    const outcome = guards.checkRateLimit(state, 3, 1000, 0);
    assert.equal(outcome.result.allowed, true);
    state = outcome.state;
  }
  const refused = guards.checkRateLimit(state, 3, 1000, 0);
  assert.equal(refused.result.allowed, false);
  assert.ok(refused.result.retryAfterMs > 0);
});

test('the rate limiter window advances with the clock', () => {
  const first = guards.checkRateLimit(null, 1, 1000, 0);
  assert.equal(first.result.allowed, true);
  const sameWindow = guards.checkRateLimit(first.state, 1, 1000, 500);
  assert.equal(sameWindow.result.allowed, false);
  const nextWindow = guards.checkRateLimit(first.state, 1, 1000, 1000);
  assert.equal(nextWindow.result.allowed, true);
});

test('a misconfigured rate limit fails closed', () => {
  assert.equal(guards.checkRateLimit(null, 0, 1000, 0).result.allowed, false);
  assert.equal(guards.checkRateLimit(null, 10, 0, 0).result.allowed, false);
});

test('an allowed origin passes and an unknown one is refused', () => {
  assert.equal(guards.isAllowedOrigin('https://tigerex.example', ['https://tigerex.example'], null), true);
  assert.equal(guards.isAllowedOrigin('https://evil.example', ['https://tigerex.example'], null), false);
});

test('a request with no origin is allowed unless the browser marks it cross-site', () => {
  assert.equal(guards.isAllowedOrigin(null, ['https://tigerex.example'], null), true);
  assert.equal(guards.isAllowedOrigin(null, ['https://tigerex.example'], 'cross-site'), false);
  assert.equal(guards.isAllowedOrigin(null, ['https://tigerex.example'], 'same-origin'), true);
});

test('SQL-injection shaped input is detected by the defence-in-depth guard', () => {
  assert.equal(guards.looksLikeSqlInjection("1' OR '1'='1"), false); // caught by binding, not this regex
  assert.equal(guards.looksLikeSqlInjection('1 UNION SELECT password FROM users'), true);
  assert.equal(guards.looksLikeSqlInjection('normal text'), false);
});

test('HTML escaping neutralises markup', () => {
  assert.equal(guards.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(guards.escapeHtml('a & "b"'), 'a &amp; &quot;b&quot;');
});

test('the rate-limit key prefers the forwarded address', () => {
  assert.equal(guards.rateLimitKey('1.2.3.4, 5.6.7.8', 'user'), 'ip:1.2.3.4');
  assert.equal(guards.rateLimitKey(null, 'user'), 'id:user');
  assert.equal(guards.rateLimitKey('', 'user'), 'id:user');
});
