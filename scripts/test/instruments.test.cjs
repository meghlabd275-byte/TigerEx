'use strict';
/**
 * Tests for options, ETF and TradFi listing validation.
 *
 * These are the listings an administrator can create. The cases that matter are
 * the ones that would otherwise produce an untradable or unsettleable
 * instrument: a past expiry, a zero strike, a zero leverage, a missing price
 * reference.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const instruments = require('../../.test-build/instruments.js');

const NOW = 1_700_000_000_000_000_000; // ns
const FUTURE = NOW + 30 * 24 * 60 * 60 * 1e9;

const validOption = {
  symbol: 'BTC/RUSD',
  underlying: 'BTC',
  settlementAsset: 'RUSD',
  optionType: 'call',
  strikePrice: 50000,
  expiryNs: FUTURE,
  exerciseStyle: 'european',
  contractSize: 1,
  tickSize: 1,
  minQuantity: 0.001,
  maxQuantity: 100,
  makerFeeBps: 2,
  takerFeeBps: 5,
};

test('a well-formed option listing is accepted', () => {
  const result = instruments.validateOptionsMarket(validOption, NOW);
  assert.ok('market' in result, JSON.stringify(result));
  assert.equal(result.market.optionType, 'call');
  assert.equal(result.market.exerciseStyle, 'european');
});

test('an option with a past expiry is refused', () => {
  const result = instruments.validateOptionsMarket({ ...validOption, expiryNs: NOW - 1 }, NOW);
  assert.ok('error' in result);
});

test('an option with a zero or negative strike is refused', () => {
  assert.ok('error' in instruments.validateOptionsMarket({ ...validOption, strikePrice: 0 }, NOW));
  assert.ok('error' in instruments.validateOptionsMarket({ ...validOption, strikePrice: -1 }, NOW));
});

test('an unknown option type is refused', () => {
  assert.ok('error' in instruments.validateOptionsMarket({ ...validOption, optionType: 'straddle' }, NOW));
});

test('an underlying that disagrees with the symbol is refused', () => {
  assert.ok('error' in instruments.validateOptionsMarket({ ...validOption, underlying: 'ETH' }, NOW));
});

test('a put is accepted', () => {
  const result = instruments.validateOptionsMarket({ ...validOption, optionType: 'put' }, NOW);
  assert.ok('market' in result);
});

test('an option with an absurd implied volatility is refused', () => {
  assert.ok('error' in instruments.validateOptionsMarket({ ...validOption, impliedVolatility: 50 }, NOW));
  assert.ok('market' in instruments.validateOptionsMarket({ ...validOption, impliedVolatility: 0.6 }, NOW));
});

const validEtf = {
  symbol: 'BTC3L/RUSD',
  underlying: 'BTC',
  settlementAsset: 'RUSD',
  leverage: 3,
  direction: 'long',
  nav: 1,
  rebalanceThreshold: 0.05,
  managementFeeApr: 0.02,
};

test('a well-formed leveraged token is accepted', () => {
  const result = instruments.validateEtfMarket(validEtf);
  assert.ok('market' in result, JSON.stringify(result));
  assert.equal(result.market.leverage, 3);
  assert.equal(result.market.direction, 'long');
});

test('a zero or fractional leverage is refused', () => {
  assert.ok('error' in instruments.validateEtfMarket({ ...validEtf, leverage: 0 }));
  assert.ok('error' in instruments.validateEtfMarket({ ...validEtf, leverage: 2.5 }));
});

test('an unknown direction is refused', () => {
  assert.ok('error' in instruments.validateEtfMarket({ ...validEtf, direction: 'sideways' }));
});

test('a non-positive NAV is refused', () => {
  assert.ok('error' in instruments.validateEtfMarket({ ...validEtf, nav: 0 }));
});

test('a management fee of 1 or more is refused', () => {
  assert.ok('error' in instruments.validateEtfMarket({ ...validEtf, managementFeeApr: 1 }));
  assert.ok('error' in instruments.validateEtfMarket({ ...validEtf, managementFeeApr: -0.1 }));
});

const validTradFi = {
  symbol: 'TSLA/RUSD',
  instrumentType: 'stock',
  settlementAsset: 'RUSD',
  priceSource: 'oracle',
  referenceSymbol: 'TSLA',
  tickSize: 0.01,
  minQuantity: 0.01,
  maxQuantity: 100000,
  maxLeverage: 5,
  makerFeeBps: 2,
  takerFeeBps: 5,
  tradingHours: '24/7',
};

test('a well-formed TradFi instrument is accepted', () => {
  const result = instruments.validateTradFiMarket(validTradFi);
  assert.ok('market' in result, JSON.stringify(result));
  assert.equal(result.market.instrumentType, 'stock');
  assert.equal(result.market.referenceSymbol, 'TSLA');
});

test('a missing reference symbol is refused: the instrument would have no price', () => {
  assert.ok('error' in instruments.validateTradFiMarket({ ...validTradFi, referenceSymbol: '' }));
  assert.ok('error' in instruments.validateTradFiMarket({ ...validTradFi, referenceSymbol: undefined }));
});

test('an unknown instrument type or price source is refused', () => {
  assert.ok('error' in instruments.validateTradFiMarket({ ...validTradFi, instrumentType: 'bond' }));
  assert.ok('error' in instruments.validateTradFiMarket({ ...validTradFi, priceSource: 'binance' }));
});

test('inverted quantity bounds are refused', () => {
  assert.ok('error' in instruments.validateTradFiMarket({ ...validTradFi, minQuantity: 100, maxQuantity: 1 }));
});

test('a leverage bracket is validated', () => {
  const result = instruments.validateRiskLimit({
    symbol: 'BTC/RUSD', tier: 1, maxPositionNotional: 1_000_000, maxLeverage: 125, maintenanceMarginRate: 0.004,
  });
  assert.ok('limit' in result, JSON.stringify(result));
  assert.equal(result.limit.tier, 1);
});

test('a risk bracket with a maintenance rate of 1 or more is refused', () => {
  assert.ok('error' in instruments.validateRiskLimit({
    symbol: 'BTC/RUSD', tier: 1, maxPositionNotional: 1_000_000, maxLeverage: 125, maintenanceMarginRate: 1,
  }));
  assert.ok('error' in instruments.validateRiskLimit({
    symbol: 'BTC/RUSD', tier: 0, maxPositionNotional: 1_000_000, maxLeverage: 125, maintenanceMarginRate: 0.004,
  }));
});

test('every listing type shares the symbol format check', () => {
  assert.ok('error' in instruments.validateEtfMarket({ ...validEtf, symbol: 'BTC3L' }));
  assert.ok('error' in instruments.validateTradFiMarket({ ...validTradFi, symbol: 'TSLA/RUSD/EXTRA' }));
  assert.ok('error' in instruments.validateOptionsMarket({ ...validOption, symbol: 'BTC/BTC' }, NOW));
});
