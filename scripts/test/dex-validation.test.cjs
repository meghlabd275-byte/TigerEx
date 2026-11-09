'use strict';
/**
 * Tests for TigerSwap administrative validation.
 *
 * These exercise the same functions the admin routes call, including the
 * snake_case row mapping the lending-market update relies on. A validator that
 * accepted an impossible parameter would let a mispriced pool or an
 * under-collateralised market reach the database, so the failure cases matter
 * as much as the success cases.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePoolInput,
  validateDexTokenInput,
  validateFarmInput,
  validateLendingMarketInput,
  validatePoolUpdate,
  lendingMarketRowToInput,
} = require('../../.test-build/validation.js');

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

test('a V2 pool needs exactly two tokens', () => {
  const three = validatePoolInput({
    kind: 'v2',
    tokens: ['RUSD', 'ETH', 'SOL'],
    fee: 0.003,
    reserves: { RUSD: 1, ETH: 1, SOL: 1 },
  });
  assert.ok('error' in three);

  const ok = validatePoolInput({
    kind: 'v2',
    tokens: ['RUSD', 'ETH'],
    fee: 0.003,
    reserves: { RUSD: 1000, ETH: 1 },
  });
  assert.ok('value' in ok);
  assert.equal(ok.value.kind, 'v2');
  assert.equal(ok.value.fee, 0.003);
});

test('a fee of exactly 1 is refused because a fee is a fraction below one', () => {
  const result = validatePoolInput({
    kind: 'v2',
    tokens: ['RUSD', 'ETH'],
    fee: 1,
    reserves: { RUSD: 1, ETH: 1 },
  });
  assert.ok('error' in result);
});

test('a stable pool requires a positive amplification coefficient', () => {
  const missing = validatePoolInput({
    kind: 'stable',
    tokens: ['RUSD', 'USDT'],
    fee: 0.0001,
    reserves: { RUSD: 1, USDT: 1 },
  });
  assert.ok('error' in missing);

  const ok = validatePoolInput({
    kind: 'stable',
    tokens: ['RUSD', 'USDT'],
    fee: 0.0001,
    amplification: 100,
    reserves: { RUSD: 1, USDT: 1 },
  });
  assert.ok('value' in ok);
  assert.equal(ok.value.amplification, 100);
});

test('a weighted pool whose weights do not sum to one is refused', () => {
  const bad = validatePoolInput({
    kind: 'weighted',
    tokens: ['TGR', 'RUSD'],
    fee: 0.003,
    weights: [0.8, 0.3],
    reserves: { TGR: 1, RUSD: 1 },
  });
  assert.ok('error' in bad);

  const ok = validatePoolInput({
    kind: 'weighted',
    tokens: ['TGR', 'RUSD'],
    fee: 0.003,
    weights: [0.8, 0.2],
    reserves: { TGR: 1, RUSD: 1 },
  });
  assert.ok('value' in ok);
  assert.deepEqual(ok.value.weights, [0.8, 0.2]);
});

test('a concentrated pool with the current price outside its range is refused', () => {
  const outside = validatePoolInput({
    kind: 'v3',
    tokens: ['RUSD', 'ETH'],
    fee: 0.003,
    tickSpacing: 60,
    sqrtPrice: 100,
    sqrtPriceLower: 30,
    sqrtPriceUpper: 60,
    reserves: { RUSD: 1, ETH: 1 },
  });
  assert.ok('error' in outside);

  const ok = validatePoolInput({
    kind: 'v3',
    tokens: ['RUSD', 'ETH'],
    fee: 0.003,
    tickSpacing: 60,
    sqrtPrice: 44.7,
    sqrtPriceLower: 30,
    sqrtPriceUpper: 60,
    reserves: { RUSD: 1, ETH: 1 },
  });
  assert.ok('value' in ok);
  assert.equal(ok.value.tickSpacing, 60);
});

test('a pool whose reserve is zero or missing is refused', () => {
  const zero = validatePoolInput({
    kind: 'v2',
    tokens: ['RUSD', 'ETH'],
    fee: 0.003,
    reserves: { RUSD: 0, ETH: 1 },
  });
  assert.ok('error' in zero);

  const missing = validatePoolInput({
    kind: 'v2',
    tokens: ['RUSD', 'ETH'],
    fee: 0.003,
    reserves: { RUSD: 1 },
  });
  assert.ok('error' in missing);
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test('a token symbol must be an asset symbol', () => {
  assert.ok('error' in validateDexTokenInput({ symbol: 'not a symbol!', name: 'Bad' }));
  const ok = validateDexTokenInput({ symbol: 'tgr', name: 'TigerEx Token' });
  assert.ok('value' in ok);
  assert.equal(ok.value.symbol, 'TGR');
  assert.equal(ok.value.decimals, 18);
});

test('a token with an address that is neither EVM nor base58 is refused', () => {
  const bad = validateDexTokenInput({ symbol: 'TGR', name: 'TigerEx', contractAddress: '0x123' });
  assert.ok('error' in bad);

  const evm = validateDexTokenInput({
    symbol: 'TGR',
    name: 'TigerEx',
    contractAddress: '0x0000000000000000000000000000000000000001',
  });
  assert.ok('value' in evm);
});

test('a token tag that is not a short lowercase identifier is refused', () => {
  const bad = validateDexTokenInput({ symbol: 'TGR', name: 'TigerEx', tags: ['Not A Tag'] });
  assert.ok('error' in bad);
});

// ---------------------------------------------------------------------------
// Farms
// ---------------------------------------------------------------------------

test('a farm requires a positive reward rate and a pool', () => {
  assert.ok('error' in validateFarmInput({ name: 'F', poolId: '', rewardToken: 'TGR', rewardRate: 1 }));
  assert.ok('error' in validateFarmInput({ name: 'F', poolId: 'p1', rewardToken: 'TGR', rewardRate: 0 }));
  const ok = validateFarmInput({ name: 'F', poolId: 'p1', rewardToken: 'TGR', rewardRate: 1 });
  assert.ok('value' in ok);
  assert.equal(ok.value.boostMultiplier, 1);
});

test('a farm whose end precedes its start is refused', () => {
  const bad = validateFarmInput({
    name: 'F',
    poolId: 'p1',
    rewardToken: 'TGR',
    rewardRate: 1,
    startAt: '2026-01-02T00:00:00.000Z',
    endAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok('error' in bad);
});

// ---------------------------------------------------------------------------
// Lending markets
// ---------------------------------------------------------------------------

const MARKET = {
  asset: 'BTC',
  ltv: 0.7,
  liquidationThreshold: 0.75,
  liquidationBonus: 0.05,
  baseRate: 0.05,
  kink: 0.8,
  jumpMultiplier: 100,
  supplyCap: 10_000_000,
  borrowCap: 8_000_000,
  status: 'active',
};

test('an LTV at or above the liquidation threshold is refused', () => {
  const bad = validateLendingMarketInput({ ...MARKET, ltv: 0.75, liquidationThreshold: 0.75 });
  assert.ok('error' in bad);
  assert.ok('value' in validateLendingMarketInput(MARKET));
});

test('a borrow cap above the supply cap is refused', () => {
  const bad = validateLendingMarketInput({ ...MARKET, borrowCap: 11_000_000 });
  assert.ok('error' in bad);
});

test('a lending market row maps onto the validator input without losing a field', () => {
  const row = {
    asset: 'BTC',
    ltv: 0.7,
    liquidation_threshold: 0.75,
    liquidation_bonus: 0.05,
    base_rate: 0.05,
    kink: 0.8,
    jump_multiplier: 100,
    supply_cap: 10_000_000,
    borrow_cap: 8_000_000,
    status: 'active',
  };
  const mapped = lendingMarketRowToInput(row);
  assert.deepEqual(mapped, MARKET);
  assert.ok('value' in validateLendingMarketInput(mapped));
});

test('a partial lending-market update survives the row mapping', () => {
  // The bug this guards: spreading the snake_case row into the validator would
  // leave every camelCase field undefined, so even a status-only change failed.
  const row = {
    asset: 'BTC',
    ltv: 0.7,
    liquidation_threshold: 0.75,
    liquidation_bonus: 0.05,
    base_rate: 0.05,
    kink: 0.8,
    jump_multiplier: 100,
    supply_cap: 10_000_000,
    borrow_cap: 8_000_000,
    status: 'active',
  };
  const merged = { ...lendingMarketRowToInput(row), status: 'paused' };
  const result = validateLendingMarketInput(merged);
  assert.ok('value' in result);
  assert.equal(result.value.status, 'paused');
  assert.equal(result.value.ltv, 0.7);
  assert.equal(result.value.supplyCap, 10_000_000);
});

// ---------------------------------------------------------------------------
// Partial pool updates
// ---------------------------------------------------------------------------

test('a partial pool update returns only the fields that were sent', () => {
  // The update route must never be forced to resend tokens and reserves: doing
  // so from a request that omitted them would zero the pool.
  const result = validatePoolUpdate({ poolId: 'p1', status: 'paused' });
  assert.ok('value' in result);
  assert.deepEqual(result.value, { status: 'paused' });
});

test('a partial pool update refuses an unknown status and a fee of one', () => {
  assert.ok('error' in validatePoolUpdate({ poolId: 'p1', status: 'closed' }));
  assert.ok('error' in validatePoolUpdate({ poolId: 'p1', fee: 1 }));
});

test('a partial pool update with no updatable field is refused', () => {
  assert.ok('error' in validatePoolUpdate({ poolId: 'p1' }));
});

test('a partial weight update must still sum to one', () => {
  assert.ok('error' in validatePoolUpdate({ poolId: 'p1', weights: [0.8, 0.3] }));
  const ok = validatePoolUpdate({ poolId: 'p1', weights: [0.7, 0.3] });
  assert.ok('value' in ok);
  assert.deepEqual(ok.value.weights, [0.7, 0.3]);
});

test('a partial price update must keep the price inside the range', () => {
  assert.ok(
    'error' in validatePoolUpdate({ poolId: 'p1', sqrtPrice: 100, sqrtPriceLower: 30, sqrtPriceUpper: 60 }),
  );
  const ok = validatePoolUpdate({ poolId: 'p1', sqrtPrice: 44.7, sqrtPriceLower: 30, sqrtPriceUpper: 60 });
  assert.ok('value' in ok);
  assert.equal(ok.value.sqrtPrice, 44.7);
});
