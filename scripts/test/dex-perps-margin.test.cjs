'use strict';
/**
 * Correctness tests for TigerSwap perpetual and margin mathematics. These are
 * the checks that guard funds: a wrong liquidation price or health factor would
 * let a solvent position be liquidated or a bad debt stay open.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { AmmError } = require('../../.test-build/amm.js');
const perps = require('../../.test-build/perps.js');
const margin = require('../../.test-build/margin.js');

const {
  requiredMargin,
  sizeForMargin,
  unrealizedPnl,
  liquidationPrice,
  shouldLiquidate,
  realizedPnl,
  fundingRateFromPremium,
  medianMarkPrice,
  liquidationPenaltySplit,
  borrowFee,
} = perps;

const {
  utilization,
  borrowRate,
  supplyRate,
  maxBorrow,
  healthFactor,
  isLiquidatable,
  liquidate,
  flashLoanFee,
  accruedInterest,
} = margin;

test('required margin is notional over leverage', () => {
  assert.ok(Math.abs(requiredMargin(1, 100, 10) - 10) < 1e-9);
});

test('size for margin inverts required margin', () => {
  const size = sizeForMargin(10, 100, 10);
  assert.ok(Math.abs(size - 1) < 1e-9);
});

test('long pnl rises with price and short pnl falls', () => {
  assert.equal(unrealizedPnl('long', 1, 100, 110), 10);
  assert.equal(unrealizedPnl('short', 1, 100, 110), -10);
});

test('liquidation price of a long sits below entry and a short above', () => {
  const long = liquidationPrice('long', 100, 10, 0.005);
  const short = liquidationPrice('short', 100, 10, 0.005);
  assert.ok(long < 100, `long liq ${long}`);
  assert.ok(short > 100, `short liq ${short}`);
});

test('a long is liquidatable only once the mark falls to the liquidation price', () => {
  const entry = 100;
  const size = 1;
  const leverage = 10;
  const mmr = 0.005;
  const collateral = requiredMargin(size, entry, leverage);
  const liq = liquidationPrice('long', entry, leverage, mmr);
  assert.equal(shouldLiquidate('long', size, entry, liq + 0.5, collateral, mmr), false);
  assert.equal(shouldLiquidate('long', size, entry, liq - 0.5, collateral, mmr), true);
});

test('realised pnl subtracts both fees', () => {
  const pnl = realizedPnl('long', 1, 100, 120, 0.001, 0.001);
  // gross 20, minus 0.1 entry fee and 0.12 exit fee
  assert.ok(Math.abs(pnl - (20 - 0.1 - 0.12)) < 1e-9);
});

test('funding rate is clamped to the cap', () => {
  const rate = fundingRateFromPremium(200, 100, 8, 0.01);
  assert.ok(rate <= 0.01 && rate >= -0.01);
});

test('funding rate is positive when the mark trades above the index', () => {
  const rate = fundingRateFromPremium(101, 100, 8, 0.01);
  assert.ok(rate > 0);
});

test('median mark price rejects a deviating source', () => {
  const price = medianMarkPrice([100, 100.5, 99.8, 500]);
  assert.ok(price > 99 && price < 101, `got ${price}`);
});

test('median mark price requires at least three sources', () => {
  assert.throws(() => medianMarkPrice([100, 101]), AmmError);
});

test('median mark price fails closed when sources disagree', () => {
  assert.throws(() => medianMarkPrice([100, 200, 300]), AmmError);
});

test('liquidation penalty is conserved across the split', () => {
  const { liquidator, insurance } = liquidationPenaltySplit(100, 0.6);
  assert.ok(Math.abs(liquidator - 60) < 1e-9);
  assert.ok(Math.abs(insurance - 40) < 1e-9);
});

test('borrow fee grows with the hold period', () => {
  assert.ok(borrowFee(1000, 0.0001, 8) > borrowFee(1000, 0.0001, 1));
});

test('utilization is zero for an empty market and rises with borrows', () => {
  assert.equal(utilization(0, 0), 0);
  assert.ok(Math.abs(utilization(50, 100) - 0.5) < 1e-9);
});

test('borrow rate jumps above the kink', () => {
  const model = { baseRate: 0.05, kink: 0.8, jumpMultiplier: 2 };
  const below = borrowRate(model, 0.5);
  const above = borrowRate(model, 0.95);
  const kinkRate = borrowRate(model, 0.8);
  assert.ok(above > kinkRate);
  assert.ok(kinkRate > below);
});

test('supply rate is below the borrow rate', () => {
  const model = { baseRate: 0.05, kink: 0.8, jumpMultiplier: 2 };
  assert.ok(supplyRate(model, 0.5) < borrowRate(model, 0.5));
});

test('max borrow is collateral value times ltv', () => {
  assert.ok(Math.abs(maxBorrow(1000, 0.7) - 700) < 1e-9);
});

test('health factor is infinite with no debt', () => {
  assert.equal(healthFactor(1000, 0.75, 0), Infinity);
});

test('a position is liquidatable when the health factor falls below 1', () => {
  assert.ok(healthFactor(1000, 0.75, 1000) < 1);
  assert.equal(isLiquidatable(1000, 0.75, 1000), true);
});

test('a liquidation repays at most the close factor and pays a bonus', () => {
  const result = liquidate(1000, 2000, 1000, 0.05, 0.5);
  assert.ok(Math.abs(result.debtRepaid - 500) < 1e-9);
  assert.ok(result.bonus > 0);
});

test('flash loan fee is a fraction of the amount', () => {
  assert.ok(Math.abs(flashLoanFee(1000, 0.0009) - 0.9) < 1e-9);
});

test('interest accrues over time', () => {
  const oneYear = accruedInterest(1000, 0.1, 365 * 24 * 60 * 60);
  assert.ok(Math.abs(oneYear - 100) < 1e-6);
});
