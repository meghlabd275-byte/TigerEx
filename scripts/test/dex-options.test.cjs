'use strict';
/**
 * Tests for the TigerSwap options AMM.
 *
 * The pure pricing and reserve math is exercised directly, and the DB-backed
 * cases run a real SQLite database built from the production schema: a pool is
 * funded, an option is bought, and the balances, pool collateral and reservation
 * it wrote are asserted. Nothing is stubbed, so a pool that writes an option it
 * cannot back, or a settlement that overpays, fails the suite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-dex-options-')), 'dex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance } = require('../../.test-build/ledger.js');
const { AmmError } = require('../../.test-build/amm.js');
const { DexError, fundBalance } = require('../../.test-build/pool-service.js');
const {
  optionPremium,
  maxPayout,
  requiredReserve,
  buyQuote,
  settlementPayout,
  writerYield,
} = require('../../.test-build/options.js');
const {
  createOptionPool,
  listOptionPools,
  fundOptionPool,
  buyOption,
  settleOption,
  settleMaturedOptions,
  optionPositions,
} = require('../../.test-build/options-service.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, 'active')`).run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
  );
  return userId;
}

function credit(userId, currency, available) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(`INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`).run(
    generateId(),
    walletId,
    currency,
    available,
  );
}

let marketSeq = 0;

/** A spot price for an underlying, expressed in RUSD, from real market data. */
function listSpot(base, price) {
  marketSeq += 1;
  db.prepare('INSERT INTO market_data (id, symbol, price, volume_24h) VALUES (?, ?, ?, 0)').run(
    generateId(),
    `${base}/RUSD`,
    price,
  );
}

// ---------------------------------------------------------------------------
// Pure pricing math
// ---------------------------------------------------------------------------

test('a call is worth more than a put when the strike is below the spot', () => {
  const call = optionPremium({ type: 'call', spot: 100, strike: 90, timeToExpiry: 0.25, volatility: 0.6, riskFreeRate: 0, contractSize: 1, quantity: 1 });
  const put = optionPremium({ type: 'put', spot: 100, strike: 90, timeToExpiry: 0.25, volatility: 0.6, riskFreeRate: 0, contractSize: 1, quantity: 1 });
  assert.ok(call.premiumPerContract > put.premiumPerContract);
  assert.ok(call.delta > 0.5 && call.delta <= 1);
  assert.ok(put.delta < 0);
});

test('the premium scales with contract size and quantity', () => {
  const one = optionPremium({ type: 'call', spot: 100, strike: 100, timeToExpiry: 0.5, volatility: 0.5, riskFreeRate: 0, contractSize: 1, quantity: 1 });
  const scaled = optionPremium({ type: 'call', spot: 100, strike: 100, timeToExpiry: 0.5, volatility: 0.5, riskFreeRate: 0, contractSize: 2, quantity: 3 });
  assert.ok(Math.abs(scaled.premium - one.premium * 6) < 1e-9);
});

test('the model fails closed on a non-positive input rather than returning NaN', () => {
  assert.throws(() => optionPremium({ type: 'call', spot: 0, strike: 100, timeToExpiry: 1, volatility: 0.5, riskFreeRate: 0, contractSize: 1, quantity: 1 }), AmmError);
  assert.throws(() => optionPremium({ type: 'call', spot: 100, strike: 100, timeToExpiry: 1, volatility: 0, riskFreeRate: 0, contractSize: 1, quantity: 1 }), AmmError);
  assert.throws(() => optionPremium({ type: 'call', spot: 100, strike: 100, timeToExpiry: 1, volatility: 0.5, riskFreeRate: 0, contractSize: 1, quantity: 0 }), AmmError);
});

test('a put reserves its full strike and a call reserves its capped payoff', () => {
  assert.equal(maxPayout('put', 100, 100, 2), 200);
  assert.equal(maxPayout('call', 100, 150, 1), 50);
  assert.throws(() => maxPayout('call', 100, 90, 1), AmmError);
  assert.equal(requiredReserve('put', 100, 100, 1, 3), 300);
});

test('a buy is refused when the pool cannot reserve the worst case', () => {
  const base = {
    type: 'call',
    spot: 100,
    strike: 100,
    capPrice: 150,
    timeToExpiry: 0.25,
    volatility: 0.5,
    riskFreeRate: 0,
    contractSize: 1,
    quantity: 1,
    feeRate: 0.005,
  };
  const ok = buyQuote({ ...base, freeCollateral: 50 });
  assert.ok(ok.reserve <= 50 + 1e-9);
  assert.throws(() => buyQuote({ ...base, freeCollateral: 49.999 }), AmmError);
});

test('settlement pays the intrinsic value capped at the reserve', () => {
  assert.equal(settlementPayout('call', 100, 120, 1, 50), 20);
  assert.equal(settlementPayout('call', 100, 200, 1, 50), 50, 'the payout is capped');
  assert.equal(settlementPayout('put', 100, 80, 1, 100), 20);
  assert.equal(settlementPayout('call', 100, 90, 1, 50), 0, 'an out-of-the-money option pays nothing');
});

test('the writer yield is zero at expiry rather than infinite', () => {
  assert.equal(writerYield(5, 100, 0), 0);
  assert.ok(writerYield(5, 100, 0.25) > 0);
});

// ---------------------------------------------------------------------------
// Pool and settlement accounting
// ---------------------------------------------------------------------------

test('a pool writes a covered call, moving the premium in and reserving the cap', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 10_000);
  listSpot('CALLCO', 100);

  const pool = createOptionPool({ underlying: 'CALLCO', settlementAsset: 'RUSD', volatility: 0.5, feeBps: 50 });
  fundOptionPool(pool.pool_id, 1_000);

  const before = availableBalance(userId, 'RUSD');
  const result = buyOption({ userId, poolId: pool.pool_id, type: 'call', strike: 100, capPrice: 150, quantity: 2 });

  assert.equal(availableBalance(userId, 'RUSD'), before - result.totalCost);
  assert.ok(result.totalCost > 0);
  assert.equal(result.reserved, 100, 'two calls capped at 150 over a 100 strike reserve 50 each');

  const stored = listOptionPools().find((row) => row.poolId === pool.pool_id);
  assert.equal(stored.reserved, 100);
  // The premium and fee the buyer paid became pool collateral.
  assert.ok(Math.abs(stored.collateral - (1_000 + result.totalCost)) < 1e-9);
  assert.equal(stored.freeCollateral, stored.collateral - 100);
  // The mirror is backed by real value in the pool's collateral account, so the
  // pool can actually pay a winning option rather than minting the payout.
  assert.ok(
    Math.abs(fundBalance(`dex_option_pool:${pool.pool_id}`, 'RUSD') - stored.collateral) < 1e-9,
    'the collateral account must hold exactly what the mirror claims',
  );
});

test('a payout fails closed when the pool has no collateral to pay with', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 10_000);
  listSpot('GHOSTCO', 100);

  const pool = createOptionPool({ underlying: 'GHOSTCO', settlementAsset: 'RUSD', volatility: 0.5 });
  fundOptionPool(pool.pool_id, 1_000);
  const buy = buyOption({ userId, poolId: pool.pool_id, type: 'call', strike: 100, capPrice: 150, quantity: 1 });

  // Simulate collateral leaving the account without the mirror being updated:
  // settlement must refuse rather than credit a payout nobody funded.
  db.prepare(
    "UPDATE treasury_accounts SET balance = 0 WHERE network = 'TIGEREX' AND account_type = ?",
  ).run(`dex_option_pool:${pool.pool_id}`);
  db.prepare('UPDATE market_data SET price = 130 WHERE symbol = ?').run('GHOSTCO/RUSD');

  const before = availableBalance(userId, 'RUSD');
  assert.throws(
    () => settleOption(userId, buy.positionId),
    (error) => error instanceof DexError && error.code === 'REWARD_FUND_EMPTY',
  );
  assert.equal(availableBalance(userId, 'RUSD'), before, 'no payout may be credited');
  assert.equal(optionPositions(userId).find((row) => row.positionId === buy.positionId).status, 'open');
});

test('a pool refuses a write it cannot back out of its free collateral', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 1_000_000);
  listSpot('TINYCO', 100);

  const pool = createOptionPool({ underlying: 'TINYCO', settlementAsset: 'RUSD', volatility: 0.5 });
  fundOptionPool(pool.pool_id, 100);

  // A put over a 100 strike reserves the full 100 per contract, so the pool can
  // back exactly one and must refuse two.
  assert.doesNotThrow(() => buyOption({ userId, poolId: pool.pool_id, type: 'put', strike: 100, quantity: 1 }));
  assert.throws(
    () => buyOption({ userId, poolId: pool.pool_id, type: 'put', strike: 100, quantity: 1 }),
    (error) => error instanceof AmmError && error.code === 'POOL_CAPACITY',
  );
});

test('a buy is refused when the buyer cannot cover the premium', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 1);
  listSpot('POORCO', 100);
  const pool = createOptionPool({ underlying: 'POORCO', settlementAsset: 'RUSD', volatility: 0.5 });
  fundOptionPool(pool.pool_id, 1_000);

  assert.throws(
    () => buyOption({ userId, poolId: pool.pool_id, type: 'call', strike: 100, capPrice: 150, quantity: 1 }),
    (error) => error instanceof DexError && error.code === 'INSUFFICIENT_BALANCE',
  );
});

test('settlement pays the holder the intrinsic value and releases the unused reserve', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 10_000);
  listSpot('SETTLECO', 100);

  const pool = createOptionPool({ underlying: 'SETTLECO', settlementAsset: 'RUSD', volatility: 0.5 });
  fundOptionPool(pool.pool_id, 1_000);
  const buy = buyOption({ userId, poolId: pool.pool_id, type: 'call', strike: 100, capPrice: 150, quantity: 1 });

  // The spot rises to 130: the call is 30 in the money, well under its 50 cap.
  db.prepare('UPDATE market_data SET price = 130 WHERE symbol = ?').run('SETTLECO/RUSD');

  const before = availableBalance(userId, 'RUSD');
  const settlement = settleOption(userId, buy.positionId);
  assert.ok(Math.abs(settlement.payout - 30) < 1e-9);
  assert.equal(settlement.released, 20);
  assert.equal(availableBalance(userId, 'RUSD'), before + 30);

  const stored = listOptionPools().find((row) => row.poolId === pool.pool_id);
  assert.equal(stored.reserved, 0, 'the whole reservation is released');

  const position = optionPositions(userId).find((row) => row.positionId === buy.positionId);
  assert.equal(position.status, 'settled');
  assert.equal(position.payout, 30);
});

test('a settlement can never pay more than the reserve the pool set aside', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 10_000);
  listSpot('CAPCO', 100);

  const pool = createOptionPool({ underlying: 'CAPCO', settlementAsset: 'RUSD', volatility: 0.5 });
  fundOptionPool(pool.pool_id, 1_000);
  const buy = buyOption({ userId, poolId: pool.pool_id, type: 'call', strike: 100, capPrice: 150, quantity: 1 });

  // The spot triples; the payout is still capped at the reserved 50.
  db.prepare('UPDATE market_data SET price = 300 WHERE symbol = ?').run('CAPCO/RUSD');
  const settlement = settleOption(userId, buy.positionId);
  assert.equal(settlement.payout, buy.maxPayout);
  assert.equal(settlement.payout, 50);

  const stored = listOptionPools().find((row) => row.poolId === pool.pool_id);
  assert.ok(stored.collateral >= 0, 'the pool never overdraws');
});

test('settling the same option twice is refused', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 10_000);
  listSpot('ONCECO', 100);
  const pool = createOptionPool({ underlying: 'ONCECO', settlementAsset: 'RUSD', volatility: 0.5 });
  fundOptionPool(pool.pool_id, 1_000);
  const buy = buyOption({ userId, poolId: pool.pool_id, type: 'call', strike: 100, capPrice: 150, quantity: 1 });
  settleOption(userId, buy.positionId);
  assert.throws(
    () => settleOption(userId, buy.positionId),
    (error) => error instanceof DexError && error.code === 'NO_POSITION',
  );
});

test('a buy records the expiry and the keeper settles it once it matures', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 10_000);
  listSpot('EXPIRECO', 100);

  const pool = createOptionPool({ underlying: 'EXPIRECO', settlementAsset: 'RUSD', volatility: 0.5 });
  fundOptionPool(pool.pool_id, 1_000);
  const expiry = new Date(Date.now() + 60_000).toISOString();
  const buy = buyOption({ userId, poolId: pool.pool_id, type: 'call', strike: 100, capPrice: 150, quantity: 1, expiry });
  assert.equal(buy.expiresAt, expiry, 'the expiry the buyer chose is stored');
  assert.equal(optionPositions(userId).find((p) => p.positionId === buy.positionId).expiresAt, expiry);

  // Before maturity the keeper must leave the option alone.
  const early = settleMaturedOptions(Date.now());
  assert.equal(early.settled.length, 0);
  assert.equal(optionPositions(userId).find((p) => p.positionId === buy.positionId).status, 'open');

  // At maturity the keeper settles it and releases the reservation. The spot is
  // raised so the call finishes in the money and the payout is observable.
  db.prepare('UPDATE market_data SET price = 120 WHERE symbol = ?').run('EXPIRECO/RUSD');
  const before = availableBalance(userId, 'RUSD');
  const matured = settleMaturedOptions(Date.now() + 120_000);
  assert.deepEqual(matured.settled, [buy.positionId]);
  assert.equal(availableBalance(userId, 'RUSD'), before + 20, 'a 120 spot over a 100 strike pays 20');

  const position = optionPositions(userId).find((p) => p.positionId === buy.positionId);
  assert.equal(position.status, 'settled');
  assert.equal(listOptionPools().find((row) => row.poolId === pool.pool_id).reserved, 0);

  // A second pass must not settle it again.
  assert.equal(settleMaturedOptions(Date.now() + 240_000).settled.length, 0);
});

test('the keeper leaves a matured option open when its underlying has no price', () => {
  const userId = seedUser();
  credit(userId, 'RUSD', 10_000);
  listSpot('NOPRICECO', 100);
  const pool = createOptionPool({ underlying: 'NOPRICECO', settlementAsset: 'RUSD', volatility: 0.5 });
  fundOptionPool(pool.pool_id, 1_000);
  const buy = buyOption({
    userId,
    poolId: pool.pool_id,
    type: 'call',
    strike: 100,
    capPrice: 150,
    quantity: 1,
    // A near expiry so only this option matures in the pass below.
    expiry: new Date(Date.now() + 60_000).toISOString(),
  });

  // Remove every price for the underlying: settlement must fail closed and the
  // position must stay open rather than settling at an invented price.
  db.prepare('DELETE FROM market_data WHERE symbol = ?').run('NOPRICECO/RUSD');
  const result = settleMaturedOptions(Date.now() + 120_000);
  assert.equal(result.settled.length, 0, 'an unpriced option must not be settled');
  assert.equal(result.failed, 1, 'the failure must be reported');
  assert.equal(optionPositions(userId).find((p) => p.positionId === buy.positionId).status, 'open');
});
