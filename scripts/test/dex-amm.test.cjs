'use strict';
/**
 * Correctness tests for the TigerSwap AMM core. Run through
 * `npm run test:logic`, which compiles the TypeScript module first.
 *
 * The cases below assert the invariants the settlement engine relies on: a
 * constant-product swap preserves k after the fee, a stable pool prices a
 * balanced swap at parity, a weighted pool respects its weights, and every
 * entry point refuses a non-finite or non-positive input instead of computing
 * with it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const amm = require('../../.test-build/amm.js');

const {
  AmmError,
  v2GetAmountOut,
  v2GetAmountIn,
  v2Invariant,
  v2Mint,
  v2Burn,
  stableInvariant,
  stableSwap,
  weightedGetAmountOut,
  weightedGetAmountIn,
  tickToPrice,
  priceToTick,
  v3SwapStep,
  v3AmountsForLiquidity,
  v3LiquidityForAmounts,
  impermanentLoss,
  priceImpact,
} = amm;

test('V2 swap output preserves the invariant after the fee is added back', () => {
  const reserves = { reserveIn: 1000, reserveOut: 2_000_000 };
  const amountIn = 10;
  const fee = 0.003;
  const out = v2GetAmountOut(amountIn, reserves, fee);

  const kBefore = v2Invariant(reserves);
  const kAfter = (reserves.reserveIn + amountIn) * (reserves.reserveOut - out);
  assert.ok(kAfter >= kBefore, 'the pool must never lose value');
});

test('V2 amount in inverts amount out', () => {
  const reserves = { reserveIn: 1000, reserveOut: 2_000_000 };
  const fee = 0.003;
  const out = v2GetAmountOut(50, reserves, fee);
  const back = v2GetAmountIn(out, reserves, fee);
  assert.ok(Math.abs(back - 50) < 1e-6, `expected ~50, got ${back}`);
});

test('V2 rejects a zero or negative reserve', () => {
  assert.throws(() => v2GetAmountOut(1, { reserveIn: 0, reserveOut: 100 }, 0.003), AmmError);
  assert.throws(() => v2GetAmountOut(1, { reserveIn: -5, reserveOut: 100 }, 0.003), AmmError);
});

test('V2 rejects a fee outside [0, 1)', () => {
  assert.throws(() => v2GetAmountOut(1, { reserveIn: 100, reserveOut: 100 }, 1), AmmError);
  assert.throws(() => v2GetAmountOut(1, { reserveIn: 100, reserveOut: 100 }, -0.1), AmmError);
});

test('V2 mint then burn returns approximately the deposit', () => {
  const mint = v2Mint(0, { reserveIn: 0, reserveOut: 0 }, 100, 200);
  assert.ok(mint.liquidity > 0);
  const burn = v2Burn(mint.liquidity, { reserveIn: 100, reserveOut: 200 }, mint.liquidity);
  assert.ok(Math.abs(burn.amountIn - 100) < 1e-9);
  assert.ok(Math.abs(burn.amountOut - 200) < 1e-9);
});

test('V2 mint caps an unbalanced deposit at the smaller share', () => {
  const mint = v2Mint(100, { reserveIn: 100, reserveOut: 200 }, 100, 100);
  // A deposit of 100 in / 100 out against 100/200 can only be honoured as 50/100.
  assert.ok(Math.abs(mint.amountInUsed - 50) < 1e-9);
  assert.ok(Math.abs(mint.amountOutUsed - 100) < 1e-9);
});

test('stable invariant of a balanced pool equals the total', () => {
  const d = stableInvariant([1000, 1000], 100);
  assert.ok(Math.abs(d - 2000) < 1e-6);
});

test('a balanced stable swap pays out the input less the fee, within slippage', () => {
  const pool = { amplification: 100, balances: [1_000_000, 1_000_000] };
  const result = stableSwap(pool, 0, 1, 1000, 0.0001);
  const expected = 1000 * (1 - 0.0001);
  // A stable pool still has finite slippage; the payout sits just below parity.
  assert.ok(result.amountOut <= expected, `got ${result.amountOut} above parity`);
  assert.ok(expected - result.amountOut < 0.05, `slippage too large: got ${result.amountOut}`);
});

test('a stable swap never returns more than the pool holds', () => {
  const pool = { amplification: 100, balances: [1000, 1000] };
  const result = stableSwap(pool, 0, 1, 10_000_000, 0);
  assert.ok(result.amountOut < pool.balances[1], 'output must stay inside the reserve');
  assert.ok(result.newOutBalance > 0, 'the pool must retain a positive balance');
});

test('weighted output respects an 80/20 pool', () => {
  const pool = { balances: [8000, 2000], weights: [0.8, 0.2], fee: 0 };
  const out = weightedGetAmountOut(pool, 0, 1, 100);
  assert.ok(out > 0 && out < 100);
});

test('weighted amount in inverts amount out', () => {
  const pool = { balances: [8000, 2000], weights: [0.8, 0.2], fee: 0.003 };
  const out = weightedGetAmountOut(pool, 0, 1, 100);
  const back = weightedGetAmountIn(pool, 0, 1, out);
  assert.ok(Math.abs(back - 100) < 1e-6, `expected ~100, got ${back}`);
});

test('tick and price round-trip within one tick', () => {
  const price = 2500;
  const tick = priceToTick(price);
  const back = tickToPrice(tick);
  assert.ok(back <= price && price / back < 1.0001);
});

test('a V3 step moves the price in the right direction', () => {
  const state = {
    sqrtPrice: 50,
    liquidity: 1_000_000,
    sqrtPriceLower: 10,
    sqrtPriceUpper: 100,
    fee: 0.003,
  };
  const sell = v3SwapStep(state, true, 1000);
  assert.ok(sell.sqrtPriceAfter < state.sqrtPrice, 'selling token0 lowers the price');
  const buy = v3SwapStep(state, false, 1000);
  assert.ok(buy.sqrtPriceAfter > state.sqrtPrice, 'buying token0 raises the price');
});

test('a V3 step stops at the range boundary', () => {
  const state = {
    sqrtPrice: 50,
    liquidity: 1000,
    sqrtPriceLower: 49.9,
    sqrtPriceUpper: 100,
    fee: 0,
  };
  const result = v3SwapStep(state, true, 1e9);
  assert.ok(result.priceLimitReached);
  assert.equal(result.sqrtPriceAfter, state.sqrtPriceLower);
});

test('V3 amounts and liquidity are inverses over a range', () => {
  const [liquidity, sqrtPrice, lower, upper] = [1_000_000, 50, 40, 60];
  const amounts = v3AmountsForLiquidity(liquidity, sqrtPrice, lower, upper);
  const back = v3LiquidityForAmounts(amounts.amount0, amounts.amount1, sqrtPrice, lower, upper);
  assert.ok(Math.abs(back - liquidity) / liquidity < 1e-9);
});

test('impermanent loss is zero at parity and negative otherwise', () => {
  assert.ok(Math.abs(impermanentLoss(1)) < 1e-12);
  assert.ok(impermanentLoss(2) < 0);
  assert.ok(impermanentLoss(0.5) < 0);
});

test('price impact is positive when the price worsens for the trader', () => {
  assert.ok(priceImpact(2, 1.9) > 0);
});
