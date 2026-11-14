'use strict';
/**
 * Linear vs inverse contract arithmetic.
 *
 * The inverse (`COIN_M`) formulas must differ from the linear ones: a short
 * gains coin as the price falls, the notional is price-independent, and the
 * liquidation price sits on the correct side of entry. A linear contract must
 * be unchanged from the classic formulas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isInverseContract,
  notionalUsd,
  positionValue,
  unrealizedPnl,
  requiredMargin,
  liquidationPrice,
} = require('../../.test-build/contract-math.js');

test('only COIN_M is inverse', () => {
  assert.equal(isInverseContract('COIN_M'), true);
  assert.equal(isInverseContract('coin_m'), true);
  for (const linear of ['USDT_M', 'USDC_M', 'RUSD_M', 'RYUSD_M', 'TGR_M']) {
    assert.equal(isInverseContract(linear), false);
  }
});

test('linear notional scales with price; inverse notional does not', () => {
  assert.equal(notionalUsd(2, 100, 1, false), 200);
  assert.equal(notionalUsd(2, 200, 1, false), 400);
  // Inverse: 2 contracts of size 1 USD are 2 USD regardless of price.
  assert.equal(notionalUsd(2, 100, 1, true), 2);
  assert.equal(notionalUsd(2, 200, 1, true), 2);
});

test('linear unrealized P&L is the price move; inverse is the coin move', () => {
  // Linear long: (110 - 100) * 1 * 1 = 10.
  assert.equal(unrealizedPnl({ inverse: false, side: 'long', quantity: 1, entryPrice: 100, markPrice: 110, contractSize: 1 }), 10);
  // Linear short: -10.
  assert.equal(unrealizedPnl({ inverse: false, side: 'short', quantity: 1, entryPrice: 100, markPrice: 110, contractSize: 1 }), -10);

  // Inverse short 100 USD contracts, price falls 100 -> 50: gains 1 coin.
  const short = unrealizedPnl({ inverse: true, side: 'short', quantity: 100, entryPrice: 100, markPrice: 50, contractSize: 1 });
  assert.ok(Math.abs(short - 1) < 1e-12, `expected 1, got ${short}`);
  // Inverse long loses coin as the price falls.
  const long = unrealizedPnl({ inverse: true, side: 'long', quantity: 100, entryPrice: 100, markPrice: 50, contractSize: 1 });
  assert.ok(Math.abs(long + 1) < 1e-12, `expected -1, got ${long}`);
});

test('linear margin is notional/leverage; inverse margin is that in coin', () => {
  // Linear: 100 * 2 / 10 = 20.
  assert.equal(requiredMargin({ inverse: false, quantity: 2, price: 100, contractSize: 1, leverage: 10 }), 20);
  // Inverse: 100 USD notional / 10 = 10 USD, converted to coin at price 100 = 0.1 BTC.
  const inverse = requiredMargin({ inverse: true, quantity: 100, price: 100, contractSize: 1, leverage: 10 });
  assert.ok(Math.abs(inverse - 0.1) < 1e-12, `expected 0.1, got ${inverse}`);
});

test('inverse long liquidation sits below entry, short above', () => {
  // 100 USD notional at price 100 is 1 coin; at 10x leverage the margin is 0.1 coin.
  const long = liquidationPrice({ inverse: true, side: 'long', quantity: 100, entryPrice: 100, contractSize: 1, margin: 0.1, maintenanceMarginRate: 0.005 });
  assert.ok(long > 0 && long < 100, `long liquidation ${long} should be below entry`);
  const short = liquidationPrice({ inverse: true, side: 'short', quantity: 100, entryPrice: 100, contractSize: 1, margin: 0.1, maintenanceMarginRate: 0.005 });
  assert.ok(short > 100, `short liquidation ${short} should be above entry`);
});

test('linear liquidation keeps the classic side convention', () => {
  const long = liquidationPrice({ inverse: false, side: 'long', quantity: 1, entryPrice: 100, contractSize: 1, margin: 10, maintenanceMarginRate: 0.005 });
  assert.ok(long > 0 && long < 100, `long liquidation ${long} should be below entry`);
  const short = liquidationPrice({ inverse: false, side: 'short', quantity: 1, entryPrice: 100, contractSize: 1, margin: 10, maintenanceMarginRate: 0.005 });
  assert.ok(short > 100, `short liquidation ${short} should be above entry`);
});

test('non-finite inputs fail closed', () => {
  assert.ok(Number.isNaN(unrealizedPnl({ inverse: true, side: 'long', quantity: 1, entryPrice: NaN, markPrice: 1, contractSize: 1 })));
  assert.ok(Number.isNaN(requiredMargin({ inverse: false, quantity: 1, price: 1, contractSize: 1, leverage: 0 })));
  assert.equal(liquidationPrice({ inverse: true, side: 'long', quantity: 0, entryPrice: 1, contractSize: 1, margin: 1, maintenanceMarginRate: 0.005 }), 0);
});
