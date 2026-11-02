'use strict';
/**
 * Correctness tests for futures and margin listing validation. Run through
 * `npm run test:logic`, which compiles the TypeScript module first.
 *
 * Each case asserts a failure the engine would otherwise be handed: a
 * perpetual with a delivery time, a dated contract without one, an initial
 * margin below maintenance margin, and a collateral LTV at or above the
 * liquidation threshold.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFuturesMarket, validateMarginMarket, MAX_LEVERAGE } = require('../../.test-build/futures.js');

const validFutures = {
  symbol: 'BTC/USDT',
  settlementAsset: 'USDT',
  contractType: 'USDT_M',
  listingType: 'perpetual',
  contractSize: 1,
  tickSize: 0.1,
  pricePrecision: 2,
  quantityPrecision: 3,
  minQuantity: 0.001,
  maxQuantity: 1000,
  maxLeverage: 125,
  makerFeeBps: 2,
  takerFeeBps: 5,
  fundingIntervalHours: 8,
  fundingRateCap: 0.01,
  maintenanceMarginRate: 0.005,
  initialMarginRate: 0.008,
  liquidationFeeRate: 0.005,
  insuranceFundShare: 0.1,
};

test('a well-formed perpetual is accepted', () => {
  const result = validateFuturesMarket(validFutures);
  assert.ok('market' in result, JSON.stringify(result));
  assert.equal(result.market.symbol, 'BTC/USDT');
  assert.equal(result.market.settlementAsset, 'USDT');
  assert.equal(result.market.deliveryTimeNs, null);
});

test('USDC-margined and inverse contracts are accepted', () => {
  assert.ok('market' in validateFuturesMarket({ ...validFutures, settlementAsset: 'USDC', contractType: 'USDC_M' }));
  assert.ok('market' in validateFuturesMarket({ ...validFutures, settlementAsset: 'BTC', contractType: 'COIN_M' }));
});

test('an unknown settlement asset is rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, settlementAsset: 'DOGE' }));
});

test('an unknown contract type is rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, contractType: 'LINEAR' }));
});

test('a perpetual carrying a delivery time is rejected', () => {
  const result = validateFuturesMarket({
    ...validFutures,
    deliveryTimeNs: Date.now() * 1e6 + 1e18,
  });
  assert.ok('error' in result);
});

test('a dated contract without a delivery time is rejected', () => {
  const result = validateFuturesMarket({ ...validFutures, listingType: 'quarterly' });
  assert.ok('error' in result);
});

test('a dated contract in the past is rejected', () => {
  const result = validateFuturesMarket({
    ...validFutures,
    listingType: 'quarterly',
    deliveryTimeNs: 1000,
  });
  assert.ok('error' in result);
});

test('a future-dated contract is accepted and keeps its delivery time', () => {
  const future = (Date.now() + 90 * 24 * 3600 * 1000) * 1e6;
  const result = validateFuturesMarket({ ...validFutures, listingType: 'quarterly', deliveryTimeNs: future });
  assert.ok('market' in result, JSON.stringify(result));
  assert.equal(result.market.deliveryTimeNs, future);
});

test('initial margin below maintenance margin is rejected', () => {
  const result = validateFuturesMarket({
    ...validFutures,
    maintenanceMarginRate: 0.01,
    initialMarginRate: 0.005,
  });
  assert.ok('error' in result);
});

test('leverage above the engine ceiling is rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, maxLeverage: MAX_LEVERAGE + 1 }));
  assert.ok('market' in validateFuturesMarket({ ...validFutures, maxLeverage: MAX_LEVERAGE }));
});

test('zero leverage is rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, maxLeverage: 0 }));
});

test('a fractional leverage is rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, maxLeverage: 10.5 }));
});

test('a funding cap above ten percent is rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, fundingRateCap: 0.2 }));
});

test('a zero tick size is rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, tickSize: 0 }));
});

test('inverted quantity bounds are rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, minQuantity: 10, maxQuantity: 1 }));
});

test('an unknown status is rejected', () => {
  assert.ok('error' in validateFuturesMarket({ ...validFutures, status: 'enabled' }));
});

const validMargin = {
  symbol: 'BTC/RUSD',
  mode: 'cross',
  maxLeverage: 10,
  collateralLtv: { BTC: 0.7, ETH: 0.65, TGR: 0.5, RUSD: 0.9, USDT: 0.9, USDC: 0.9 },
  liquidationThresholds: { BTC: 0.75, ETH: 0.7, TGR: 0.6, RUSD: 0.95, USDT: 0.95, USDC: 0.95 },
  borrowableAssets: ['RUSD', 'USDT', 'USDC', 'BTC', 'ETH'],
  interestBaseApr: 0.05,
  interestKinkUtilization: 0.8,
  interestKinkApr: 0.5,
  interestMaxApr: 1.0,
  liquidationBonus: 0.05,
  riskTier: 'medium',
};

test('a well-formed margin market is accepted', () => {
  const result = validateMarginMarket(validMargin);
  assert.ok('market' in result, JSON.stringify(result));
  assert.equal(result.market.symbol, 'BTC/RUSD');
  assert.equal(result.market.collateralLtv.BTC, 0.7);
});

test('an LTV at or above its own liquidation threshold is rejected', () => {
  const result = validateMarginMarket({
    ...validMargin,
    collateralLtv: { BTC: 0.8 },
    liquidationThresholds: { BTC: 0.75 },
  });
  assert.ok('error' in result);
});

test('a collateral asset with no threshold is rejected', () => {
  const result = validateMarginMarket({
    ...validMargin,
    collateralLtv: { BTC: 0.7, SOL: 0.5 },
    liquidationThresholds: { BTC: 0.75 },
  });
  assert.ok('error' in result);
});

test('an LTV of exactly one is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, collateralLtv: { BTC: 1 } }));
});

test('a negative LTV is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, collateralLtv: { BTC: -0.5 } }));
});

test('an empty collateral list is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, collateralLtv: {} }));
});

test('an empty borrowable list is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, borrowableAssets: [] }));
});

test('a kink APR below the base APR is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, interestBaseApr: 0.6, interestKinkApr: 0.5 }));
});

test('a max APR below the kink APR is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, interestMaxApr: 0.4 }));
});

test('margin leverage above ten is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, maxLeverage: 11 }));
});

test('an unknown margin mode is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, mode: 'unified' }));
});

test('an isolated pool is accepted', () => {
  const result = validateMarginMarket({
    ...validMargin,
    symbol: 'TGR/RUSD',
    mode: 'isolated',
    collateralLtv: { TGR: 0.5 },
    liquidationThresholds: { TGR: 0.6 },
    borrowableAssets: ['RUSD'],
  });
  assert.ok('market' in result, JSON.stringify(result));
  assert.equal(result.market.mode, 'isolated');
});

test('a symbol whose legs disagree with its asset codes is rejected', () => {
  assert.ok('error' in validateMarginMarket({ ...validMargin, baseAsset: 'ETH' }));
});
