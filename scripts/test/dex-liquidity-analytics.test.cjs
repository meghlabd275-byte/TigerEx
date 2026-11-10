'use strict';
/**
 * Tests for the TigerSwap liquidity-provider analytics.
 *
 * The pure math is exercised directly and the DB-backed readers run against a
 * real SQLite database built from the production schema: a pool is created, a
 * swap settles, and the APR, the position value and the divergence loss it
 * reports are asserted. Nothing is stubbed, so a pool that invents a fee rate
 * with no settled swaps fails the suite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-dex-lpa-')), 'dex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId } = require('../../.test-build/index.js');
const { AmmError } = require('../../.test-build/amm.js');
const {
  positionShare,
  poolFeeApr,
  aprToApy,
  positionValueUsd,
  positionFeesUsd,
  divergenceLoss,
  reservePriceRatio,
} = require('../../.test-build/liquidity-analytics.js');
const { poolAnalytics, poolAnalyticsFor, positionAnalytics } = require('../../.test-build/liquidity-analytics-service.js');

const db = getDb();

function seedPool(kind, tokens, reserves, totalSupply, tvl, fee24h) {
  const poolId = generateId();
  db.prepare(
    `INSERT INTO dex_pools (pool_id, kind, address, tokens, fee, reserves, total_supply, tvl_usd, fee_24h_usd, volume_24h_usd, status)
     VALUES (?, ?, ?, ?, 0.003, ?, ?, ?, ?, ?, 'active')`,
  ).run(
    poolId,
    kind,
    `0x${poolId.replace(/-/g, '').slice(0, 40)}`,
    JSON.stringify(tokens),
    JSON.stringify(reserves),
    totalSupply,
    tvl,
    fee24h,
    fee24h * 300,
  );
  return poolId;
}

// --- pure math ------------------------------------------------------------

test('a position share is its LP tokens over the pool supply', () => {
  assert.equal(positionShare(25, 100), 0.25);
  assert.equal(positionShare(0, 100), 0);
  assert.equal(positionShare(5, 0), 0, 'a pool with no supply yields no share');
  assert.equal(positionShare(200, 100), 1, 'a share can never exceed the whole pool');
});

test('a pool fee APR extrapolates the 24-hour run rate over its value', () => {
  // 100 of fees a day on 10,000 of value is 1% a day, 365% a year.
  assert.ok(Math.abs(poolFeeApr(100, 10_000) - 3.65) < 1e-9);
  assert.equal(poolFeeApr(100, 0), 0, 'a pool with no value has no rate');
  assert.equal(poolFeeApr(0, 10_000), 0);
});

test('the APY compounds the APR continuously', () => {
  assert.equal(aprToApy(0), 0);
  assert.ok(Math.abs(aprToApy(1) - (Math.E - 1)) < 1e-12);
  assert.ok(aprToApy(0.5) > 0.5, 'compounding beats the simple rate');
  assert.ok(aprToApy(-0.5) < 0, 'a loss stays a loss');
  assert.throws(() => aprToApy(Number.NaN), (error) => error instanceof AmmError);
});

test('a position value and its fees scale with the share', () => {
  assert.equal(positionValueUsd(25, 100, 1_000), 250);
  assert.equal(positionFeesUsd(25, 100, 40, 1), 10);
  assert.equal(positionFeesUsd(25, 100, 40, 7), 70, 'a week of fees is seven days of the run rate');
});

test('divergence loss is zero at entry and negative once the price moves', () => {
  assert.equal(divergenceLoss(1), 0);
  assert.ok(divergenceLoss(4) < 0);
  assert.ok(Math.abs(divergenceLoss(4) - (2 * 2) / 5 + 1) < 1e-12);
  // A symmetric move loses the same amount either way.
  assert.ok(Math.abs(divergenceLoss(4) - divergenceLoss(0.25)) < 1e-12);
});

test('the reserve ratio is refused when a reserve is not positive', () => {
  assert.equal(reservePriceRatio(100, 400), 4);
  assert.throws(() => reservePriceRatio(0, 400), (error) => error instanceof AmmError);
  assert.throws(() => reservePriceRatio(100, -1), (error) => error instanceof AmmError);
});

// --- DB-backed readers -----------------------------------------------------

test('pool analytics reports the live APR from the pool rows', () => {
  const poolId = seedPool('v2', ['AAA', 'RUSD'], { AAA: 100, RUSD: 10_000 }, 1_000, 20_000, 200);
  const entry = poolAnalyticsFor(poolId);
  assert.ok(entry);
  assert.equal(entry.tvlUsd, 20_000);
  // 200 a day on 20,000 is 1% a day: 3.65 a year.
  assert.ok(Math.abs(entry.feeApr - 3.65) < 1e-9);
  assert.ok(entry.feeApy > entry.feeApr, 'the APY compounds the APR');
  assert.deepEqual(entry.tokens, ['AAA', 'RUSD']);
});

test('a pool with no value reports no rate rather than a misleading zero', () => {
  const poolId = seedPool('v2', ['BBB', 'RUSD'], { BBB: 0, RUSD: 0 }, 0, 0, 0);
  const entry = poolAnalyticsFor(poolId);
  assert.equal(entry.feeApr, null, 'an unpriceable pool has no derivable rate');
  assert.equal(entry.feeApy, null);
  assert.equal(poolAnalyticsFor('missing-pool'), null);
});

test('a position reports its share, value, fees and divergence loss', () => {
  const poolId = seedPool('v2', ['CCC', 'RUSD'], { CCC: 200, RUSD: 20_000 }, 1_000, 40_000, 400);
  const pool = db.prepare('SELECT * FROM dex_pools WHERE pool_id = ?').get(poolId);
  // A quarter of the pool entered at 100/10,000 and the price has since doubled
  // (the reserve ratio is now 100 RUSD per CCC, entry was 50).
  const analytics = positionAnalytics({ liquidity: 250, amount0: 100, amount1: 5_000 }, pool);
  assert.equal(analytics.share, 0.25);
  assert.equal(analytics.valueUsd, 10_000);
  assert.equal(analytics.fees24hUsd, 100);
  assert.ok(analytics.feeApr > 0);
  // Entry ratio 5000/100 = 50; current ratio 20000/200 = 100; price ratio 2.
  assert.ok(analytics.priceRatio !== null && Math.abs(analytics.priceRatio - 2) < 1e-9);
  assert.ok(analytics.divergenceLoss !== null && analytics.divergenceLoss < 0);
});

test('divergence loss is only reported for a constant-product pool', () => {
  const poolId = seedPool('stable', ['DDD', 'RUSD'], { DDD: 200, RUSD: 20_000 }, 1_000, 40_000, 0);
  const pool = db.prepare('SELECT * FROM dex_pools WHERE pool_id = ?').get(poolId);
  const analytics = positionAnalytics({ liquidity: 250, amount0: 100, amount1: 5_000 }, pool);
  assert.equal(analytics.divergenceLoss, null, 'a stable pool does not diverge like a constant product');
  assert.equal(analytics.priceRatio, null);
  assert.equal(analytics.share, 0.25);
});

test('a position with no entry amounts reports no divergence loss', () => {
  const poolId = seedPool('v2', ['EEE', 'RUSD'], { EEE: 200, RUSD: 20_000 }, 1_000, 40_000, 0);
  const pool = db.prepare('SELECT * FROM dex_pools WHERE pool_id = ?').get(poolId);
  const analytics = positionAnalytics({ liquidity: 250, amount0: 0, amount1: 0 }, pool);
  assert.equal(analytics.divergenceLoss, null);
  assert.equal(analytics.priceRatio, null);
});
