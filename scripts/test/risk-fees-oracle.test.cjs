'use strict';
/**
 * Tests for the fee engine, risk engine, oracle and options pricing.
 *
 * These cover the arithmetic that moves money and decides liquidations, so the
 * failure cases matter as much as the happy paths: a fee that pays the trader,
 * a position liquidated while healthy, a manipulated oracle, a NaN premium.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fees = require('../../.test-build/fees.js');
const risk = require('../../.test-build/engine.js');
const oracle = require('../../.test-build/aggregator.js');
const options = require('../../.test-build/pricing.js');

// ---------------------------------------------------------------------------
// Fee engine
// ---------------------------------------------------------------------------

const TIERS = [
  { level: 0, name: 'VIP 0', spotMaker: 0.001, spotTaker: 0.001, futuresMaker: 0.0002, futuresTaker: 0.0005, volumeThreshold: 0, holdingThreshold: 0 },
  { level: 1, name: 'VIP 1', spotMaker: 0.0009, spotTaker: 0.001, futuresMaker: 0.00018, futuresTaker: 0.00045, volumeThreshold: 1_000_000, holdingThreshold: 100 },
  { level: 2, name: 'VIP 2', spotMaker: 0.0007, spotTaker: 0.0008, futuresMaker: 0.00015, futuresTaker: 0.0004, volumeThreshold: 10_000_000, holdingThreshold: 1000 },
];

test('the highest qualifying tier wins', () => {
  const resolved = fees.resolveFeeTier(TIERS, { volume30d: 20_000_000, holding: 5000 });
  assert.equal(resolved.level, 2);
});

test('volume without the holding requirement does not grant the tier', () => {
  const resolved = fees.resolveFeeTier(TIERS, { volume30d: 20_000_000, holding: 0 });
  assert.equal(resolved.level, 0);
});

test('holding without volume does not grant the tier', () => {
  const resolved = fees.resolveFeeTier(TIERS, { volume30d: 0, holding: 100000 });
  assert.equal(resolved.level, 0);
});

test('paying in the native token applies the discount to every rate', () => {
  const plain = fees.resolveFeeTier(TIERS, { volume30d: 0, holding: 0 });
  const discounted = fees.resolveFeeTier(TIERS, { volume30d: 0, holding: 0, payInNative: true });
  assert.ok(discounted.spotTaker < plain.spotTaker);
  assert.ok(Math.abs(discounted.spotTaker - plain.spotTaker * 0.75) < 1e-12);
  assert.equal(discounted.nativeDiscount, 0.25);
});

test('an empty fee schedule is an error, not a free trade', () => {
  assert.throws(() => fees.resolveFeeTier([], { volume30d: 0, holding: 0 }));
});

test('a negative or NaN volume cannot qualify for a discount', () => {
  assert.equal(fees.resolveFeeTier(TIERS, { volume30d: -5, holding: 1e9 }).level, 0);
  assert.equal(fees.resolveFeeTier(TIERS, { volume30d: NaN, holding: 1e9 }).level, 0);
});

test('referral commission splits the fee and never exceeds it', () => {
  const split = fees.splitReferralCommission(10, 0.4);
  assert.equal(split.referrerShare, 4);
  assert.equal(split.exchangeShare, 6);
  const capped = fees.splitReferralCommission(10, 5);
  assert.equal(capped.referrerShare, 10);
  assert.equal(capped.exchangeShare, 0);
});

test('a non-positive fee pays no commission', () => {
  assert.deepEqual(fees.splitReferralCommission(0, 0.4), { referrerShare: 0, exchangeShare: 0 });
  assert.deepEqual(fees.splitReferralCommission(-1, 0.4), { referrerShare: 0, exchangeShare: 0 });
});

test('borrow interest rises with utilisation and follows the kink', () => {
  const atZero = fees.borrowInterest(1000, 0, 0.05, 0.8, 0.5, 1.0, 24 * 365);
  assert.ok(Math.abs(atZero - 1000 * 0.05) < 1e-6);
  const atKink = fees.borrowInterest(1000, 0.8, 0.05, 0.8, 0.5, 1.0, 24 * 365);
  assert.ok(Math.abs(atKink - 1000 * 0.5) < 1e-6);
  const aboveKink = fees.borrowInterest(1000, 1.0, 0.05, 0.8, 0.5, 1.0, 24 * 365);
  assert.ok(Math.abs(aboveKink - 1000 * 1.0) < 1e-6);
});

test('borrow interest is zero for a non-positive principal or period', () => {
  assert.equal(fees.borrowInterest(0, 0.5, 0.05, 0.8, 0.5, 1, 24), 0);
  assert.equal(fees.borrowInterest(100, 0.5, 0.05, 0.8, 0.5, 1, 0), 0);
  assert.equal(fees.borrowInterest(NaN, 0.5, 0.05, 0.8, 0.5, 1, 24), 0);
});

// ---------------------------------------------------------------------------
// Risk engine
// ---------------------------------------------------------------------------

test('a long in profit has positive unrealized PnL and is not liquidatable', () => {
  const r = risk.positionRisk({ side: 'long', quantity: 1, entryPrice: 100, markPrice: 110, leverage: 10, margin: 10, maintenanceMarginRate: 0.005 });
  assert.ok(!('error' in r));
  assert.ok(Math.abs(r.unrealizedPnl - 10) < 1e-9);
  assert.equal(r.liquidatable, false);
});

test('a long in loss below maintenance margin is liquidatable', () => {
  const r = risk.positionRisk({ side: 'long', quantity: 1, entryPrice: 100, markPrice: 90, leverage: 10, margin: 10, maintenanceMarginRate: 0.005 });
  assert.ok(!('error' in r));
  assert.equal(r.liquidatable, true);
});

test('a short profits when the mark falls', () => {
  const r = risk.positionRisk({ side: 'short', quantity: 1, entryPrice: 100, markPrice: 90, leverage: 10, margin: 10, maintenanceMarginRate: 0.005 });
  assert.ok(!('error' in r));
  assert.ok(r.unrealizedPnl > 0);
});

test('a non-positive quantity or price is an error, not a zero position', () => {
  assert.ok('error' in risk.positionRisk({ side: 'long', quantity: 0, entryPrice: 100, markPrice: 100, leverage: 10, margin: 10, maintenanceMarginRate: 0.005 }));
  assert.ok('error' in risk.positionRisk({ side: 'long', quantity: 1, entryPrice: NaN, markPrice: 100, leverage: 10, margin: 10, maintenanceMarginRate: 0.005 }));
  assert.ok('error' in risk.positionRisk({ side: 'long', quantity: 1, entryPrice: 100, markPrice: 100, leverage: 10, margin: 10, maintenanceMarginRate: 1.5 }));
});

test('risk tier selection picks the first cap that covers the notional', () => {
  const tiers = [
    { tier: 1, maxPositionNotional: 1_000_000, maxLeverage: 125, maintenanceMarginRate: 0.004 },
    { tier: 2, maxPositionNotional: 5_000_000, maxLeverage: 100, maintenanceMarginRate: 0.005 },
  ];
  assert.equal(risk.selectRiskTier(tiers, 500_000).tier, 1);
  assert.equal(risk.selectRiskTier(tiers, 2_000_000).tier, 2);
});

test('a notional beyond every tier is refused', () => {
  const tiers = [{ tier: 1, maxPositionNotional: 1_000_000, maxLeverage: 125, maintenanceMarginRate: 0.004 }];
  assert.ok('error' in risk.selectRiskTier(tiers, 2_000_000));
  assert.ok('error' in risk.selectRiskTier([], 1));
});

test('ADL dequeues the most profitable, most leveraged positions first', () => {
  const queue = risk.adlQueue([
    { userId: 'a', side: 'long', notional: 100, leverage: 10, pnlRatio: 0.1 },
    { userId: 'b', side: 'long', notional: 100, leverage: 50, pnlRatio: 0.1 },
    { userId: 'c', side: 'short', notional: 100, leverage: 20, pnlRatio: 0.3 },
  ]);
  assert.equal(queue[0].userId, 'c');
  assert.equal(queue[1].userId, 'b');
});

test('insurance shortfall is only the negative equity', () => {
  assert.equal(risk.insuranceShortfall(5), 0);
  assert.equal(risk.insuranceShortfall(-5), 5);
  assert.equal(risk.insuranceShortfall(NaN), 0);
});

test('the insurance fund arms ADL only below its threshold', () => {
  const healthy = risk.insuranceFundStatus(1_000_000, 1_000_000, 500_000);
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.adlArmed, false);
  const low = risk.insuranceFundStatus(400_000, 1_000_000, 500_000);
  assert.equal(low.healthy, false);
  assert.equal(low.adlArmed, true);
});

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

const NOW = 1_000_000_000_000;

test('the index price is the weighted median of fresh sources', () => {
  const result = oracle.indexPrice([
    { source: 'a', price: 100, publishedNs: NOW, weight: 1 },
    { source: 'b', price: 101, publishedNs: NOW, weight: 1 },
    { source: 'c', price: 102, publishedNs: NOW, weight: 1 },
  ], NOW);
  assert.ok(!('error' in result));
  assert.equal(result.price, 101);
});

test('a stale source is discarded', () => {
  const result = oracle.indexPrice([
    { source: 'a', price: 100, publishedNs: NOW, weight: 1 },
    { source: 'b', price: 101, publishedNs: NOW, weight: 1 },
    { source: 'stale', price: 500, publishedNs: NOW - 10 * 60 * 1e9, weight: 1 },
  ], NOW);
  assert.ok(!('error' in result));
  assert.ok(result.discarded.includes('stale'));
  // With two equal-weight sources the lower of the pair is the weighted median.
  assert.equal(result.price, 100);
});

test('a deviating source is discarded rather than moving the index', () => {
  const result = oracle.indexPrice([
    { source: 'a', price: 100, publishedNs: NOW, weight: 1 },
    { source: 'b', price: 101, publishedNs: NOW, weight: 1 },
    { source: 'bogus', price: 1000, publishedNs: NOW, weight: 1 },
  ], NOW);
  assert.ok(!('error' in result));
  assert.ok(result.discarded.includes('bogus'));
});

test('too few fresh sources publishes no price at all', () => {
  const result = oracle.indexPrice([{ source: 'a', price: 100, publishedNs: NOW, weight: 1 }], NOW);
  assert.ok('error' in result);
});

test('a non-finite or non-positive source price is discarded', () => {
  const result = oracle.indexPrice([
    { source: 'a', price: 100, publishedNs: NOW, weight: 1 },
    { source: 'b', price: 101, publishedNs: NOW, weight: 1 },
    { source: 'nan', price: NaN, publishedNs: NOW, weight: 1 },
    { source: 'neg', price: -5, publishedNs: NOW, weight: 1 },
  ], NOW);
  assert.ok(!('error' in result));
  assert.ok(result.discarded.includes('nan'));
  assert.ok(result.discarded.includes('neg'));
});

test('the mark price blends the index with the book and falls back to the index', () => {
  assert.equal(oracle.markPrice(100, null), 100);
  assert.equal(oracle.markPrice(100, 110, 0.5), 105);
  assert.ok('error' in oracle.markPrice(0, 100));
});

test('the funding rate is clamped to its cap', () => {
  const clamped = oracle.fundingRate(200, 100, 0, 0.01);
  assert.equal(clamped, 0.01);
  const negative = oracle.fundingRate(100, 100, 0, 0.01);
  assert.equal(negative, 0);
  assert.ok('error' in oracle.fundingRate(0, 100, 0, 0.01));
});

test('a long pays positive funding and a short receives it', () => {
  assert.equal(oracle.fundingPayment(1000, 0.001, 'long'), -1);
  assert.equal(oracle.fundingPayment(1000, 0.001, 'short'), 1);
});

// ---------------------------------------------------------------------------
// Options pricing
// ---------------------------------------------------------------------------

test('a call has a positive premium and a delta in (0, 1)', () => {
  const priced = options.blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, volatility: 0.5, riskFreeRate: 0.05, type: 'call' });
  assert.ok(!('error' in priced));
  assert.ok(priced.price > 0);
  assert.ok(priced.delta > 0 && priced.delta < 1);
});

test('a put has a delta in (-1, 0)', () => {
  const priced = options.blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, volatility: 0.5, riskFreeRate: 0.05, type: 'put' });
  assert.ok(!('error' in priced));
  assert.ok(priced.delta < 0 && priced.delta > -1);
});

test('put-call parity holds within tolerance', () => {
  const call = options.blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, volatility: 0.5, riskFreeRate: 0.05, type: 'call' });
  const put = options.blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, volatility: 0.5, riskFreeRate: 0.05, type: 'put' });
  const lhs = call.price - put.price;
  const rhs = 100 - 100 * Math.exp(-0.05);
  assert.ok(Math.abs(lhs - rhs) < 1e-6, `parity: ${lhs} vs ${rhs}`);
});

test('an at-expiry option is worth its intrinsic value only', () => {
  const priced = options.blackScholes({ spot: 110, strike: 100, timeToExpiry: 0, volatility: 0.5, riskFreeRate: 0.05, type: 'call' });
  assert.ok(!('error' in priced));
  assert.equal(priced.price, 10);
  assert.equal(priced.gamma, 0);
});

test('a NaN spot or non-positive volatility is refused, not priced at NaN', () => {
  assert.ok('error' in options.blackScholes({ spot: NaN, strike: 100, timeToExpiry: 1, volatility: 0.5, riskFreeRate: 0.05, type: 'call' }));
  assert.ok('error' in options.blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, volatility: 0, riskFreeRate: 0.05, type: 'call' }));
  assert.ok('error' in options.blackScholes({ spot: 100, strike: -1, timeToExpiry: 1, volatility: 0.5, riskFreeRate: 0.05, type: 'call' }));
});

test('settlement pays the intrinsic value and never a negative amount', () => {
  assert.equal(options.settlementValue('call', 100, 120), 20);
  assert.equal(options.settlementValue('call', 100, 80), 0);
  assert.equal(options.settlementValue('put', 100, 80), 20);
  assert.equal(options.settlementValue('call', 100, NaN), 0);
});

test('implied volatility inverts the model', () => {
  const target = options.blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, volatility: 0.6, riskFreeRate: 0.05, type: 'call' });
  const iv = options.impliedVolatility({ spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0.05, type: 'call' }, target.price);
  assert.ok(iv !== null);
  assert.ok(Math.abs(iv - 0.6) < 1e-3, `iv=${iv}`);
});

test('implied volatility returns null for a price outside the arbitrage bounds', () => {
  assert.equal(options.impliedVolatility({ spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0.05, type: 'call' }, 1000), null);
  assert.equal(options.impliedVolatility({ spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0.05, type: 'call' }, 0), null);
});
