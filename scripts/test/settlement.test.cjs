'use strict';
/**
 * Tests for the scheduled settlement jobs.
 *
 * A perpetual only works if funding is charged on a schedule, an option only
 * expires if someone settles it, and a leveraged token only tracks its index if
 * its NAV is rebalanced. These tests drive the real engines against a real
 * database and assert the money movements, the skip cases (a contract with no
 * fresh price is never settled at a guess) and the rebalance triggers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-settlement-')), 'settlement.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';
process.env.TIGEREX_OPTIONS_DEFAULT_VOLATILITY = '0.8';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, creditAvailable } = require('../../.test-build/ledger.js');
const { placeFuturesOrder, listPositions, markPriceFor } = require('../../.test-build/futures-engine.js');
const optionsEngine = require('../../.test-build/options-engine.js');
const settlement = require('../../.test-build/settlement.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare('INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, ?)').run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
    'active',
  );
  return userId;
}

function credit(userId, currency, available) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(
    'INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)',
  ).run(generateId(), walletId, currency, available);
}

function setPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (id, symbol, price) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price`,
  ).run(generateId(), symbol, price);
}

let seq = 0;

/** List a perpetual with its own symbol and two oracle sources at one price. */
function listPerp(base, price, overrides = {}) {
  seq += 1;
  const symbol = `${base}${seq}/RUSD`;
  db.prepare(
    `INSERT INTO futures_markets
       (market_id, symbol, base_asset, quote_asset, settlement_asset, contract_type, listing_type,
        contract_size, tick_size, min_quantity, max_quantity, max_leverage, maker_fee_bps, taker_fee_bps,
        funding_interval_hours, funding_rate_cap, maintenance_margin_rate, initial_margin_rate,
        liquidation_fee_rate, insurance_fund_share, status)
     VALUES (?, ?, ?, 'RUSD', 'RUSD', 'RUSD_M', ?, 1, 0.1, 0.001, 1000000, 125, 2, 5, ?, 0.01, 0.005, 0.008, 0.005, 0.1, 'active')`,
  ).run(generateId(), symbol, base, overrides.listingType ?? 'perpetual', overrides.intervalHours ?? 8);
  for (const name of ['chainlink', 'pyth']) {
    db.prepare(
      'INSERT INTO oracle_sources (source_id, symbol, source_name, weight, max_deviation, status) VALUES (?, ?, ?, 1, 0.05, ?)',
    ).run(generateId(), symbol, name, 'active');
    db.prepare(
      'INSERT INTO oracle_prices (price_id, symbol, source_name, price, confidence, published_ns) VALUES (?, ?, ?, ?, 1, ?)',
    ).run(generateId(), symbol, name, price, Date.now() * 1_000_000);
  }
  return symbol;
}

/**
 * A clearly-past expiry in nanoseconds.
 *
 * An expiry is compared as `expiryNs / 1e6` against `Date.now()`. A value right
 * at the current millisecond can round a fraction into the future, so tests use
 * an expiry a full minute in the past and never straddle the boundary.
 */
function expiredNs() {
  return (Date.now() - 60_000) * 1e6;
}

function listOption(symbol, underlying, optionType, strike, expiryNs) {
  const marketId = generateId();
  db.prepare(
    `INSERT INTO options_markets
       (market_id, symbol, underlying, settlement_asset, option_type, strike_price, expiry_ns,
        exercise_style, contract_size, tick_size, min_quantity, max_quantity, taker_fee_bps, status)
     VALUES (?, ?, ?, 'RUSD', ?, ?, ?, 'european', 1, 0.01, 1, 100000, 5, 'active')`,
  ).run(marketId, symbol, underlying, optionType, strike, expiryNs);
  return marketId;
}

function listEtf(symbol, underlying, nav, lastRebalanceNs) {
  const marketId = generateId();
  db.prepare(
    `INSERT INTO etf_markets
       (market_id, symbol, underlying, settlement_asset, leverage, direction, nav, reference_price, last_rebalance_ns, status)
     VALUES (?, ?, ?, 'RUSD', 3, 'long', ?, ?, ?, 'active')`,
  ).run(marketId, symbol, underlying, nav, nav, lastRebalanceNs);
  return marketId;
}

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------

test('a due perpetual is funded and the funding row records the mark and index', () => {
  const symbol = listPerp('FBTC', 50000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 0.1, leverage: 10 });

  const before = availableBalance(user, 'RUSD');
  const result = settlement.settleDueFunding();

  const applied = result.applied.find((entry) => entry.symbol === symbol);
  assert.ok(applied, 'the contract should have been funded');
  assert.equal(applied.positions, 1);

  // A long pays funding when the rate is positive; at mark == index the rate is
  // zero, so nothing moves and the funding row is still written as the baseline.
  const after = availableBalance(user, 'RUSD');
  assert.ok(after <= before + 1e-9);

  const row = db
    .prepare('SELECT mark_price, index_price FROM funding_rates WHERE symbol = ?')
    .get(symbol);
  assert.equal(row.mark_price, 50000);
  assert.equal(row.index_price, 50000);
});

test('a contract funded inside its interval is not funded again', () => {
  const symbol = listPerp('FETH', 3000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 1, leverage: 10 });

  settlement.settleDueFunding();
  const second = settlement.settleDueFunding();
  assert.ok(!second.applied.some((entry) => entry.symbol === symbol));
});

test('a contract with no mark price is skipped, never funded at a guess', () => {
  const symbol = listPerp('FNOPRICE', 100);
  // Remove the oracle prices so the mark price cannot be derived.
  db.prepare('DELETE FROM oracle_prices WHERE symbol = ?').run(symbol);
  assert.equal(markPriceFor(symbol), null);

  const result = settlement.settleDueFunding();
  assert.ok(!result.applied.some((entry) => entry.symbol === symbol));
  assert.ok(result.skipped.includes(symbol));
  const rows = db.prepare('SELECT COUNT(*) AS n FROM funding_rates WHERE symbol = ?').get(symbol);
  assert.equal(rows.n, 0);
});

test('a dated contract is not funded as a perpetual', () => {
  const symbol = listPerp('FDATE', 2000, { listingType: 'quarterly' });
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 1, leverage: 5 });

  const result = settlement.settleDueFunding();
  assert.ok(!result.applied.some((entry) => entry.symbol === symbol));
});

// ---------------------------------------------------------------------------
// Options expiry
// ---------------------------------------------------------------------------

test('an expired in-the-money call settles and pays the holder its intrinsic', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  setPrice('SXBTUSDT', 50000);

  const expiryNs = Date.now() * 1e6 + 30 * 86400e9;
  const marketId = listOption('SXBT-50000-C', 'SXBT', 'call', 50000, expiryNs);
  optionsEngine.openPosition({ userId: user, symbol: 'SXBT-50000-C', side: 'long', quantity: 1 });

  // The underlying rallies, then the contract expires.
  setPrice('SXBTUSDT', 60000);
  db.prepare('UPDATE options_markets SET expiry_ns = ? WHERE market_id = ?').run(expiredNs(), marketId);

  const before = availableBalance(user, 'RUSD');
  const result = settlement.settleExpiredOptions();
  const settled = result.settled.find((entry) => entry.symbol === 'SXBT-50000-C');
  assert.ok(settled, 'the contract should have settled');
  assert.equal(settled.settled, 1);
  // Intrinsic is 60,000 - 50,000 = 10,000 per contract.
  assert.equal(settled.totalValue, 10000);
  assert.ok(availableBalance(user, 'RUSD') > before);

  const position = db.prepare('SELECT status FROM options_positions WHERE market_id = ?').get(marketId);
  assert.equal(position.status, 'settled');
});

test('a contract whose underlying has no settlement price is skipped, not settled at a guess', () => {
  const marketId = listOption('SNOPRICE-1-C', 'SNOPRICE', 'call', 10, expiredNs());
  const result = settlement.settleExpiredOptions();
  assert.ok(result.skipped.includes('SNOPRICE-1-C'), `skipped=${JSON.stringify(result.skipped)} settled=${JSON.stringify(result.settled)}`);
  const position = db.prepare('SELECT COUNT(*) AS n FROM options_positions WHERE market_id = ?').get(marketId);
  assert.equal(position.n, 0);
});

// ---------------------------------------------------------------------------
// Leveraged tokens
// ---------------------------------------------------------------------------

test('a token whose day is up is rebalanced and its NAV is marked to the underlying', () => {
  setPrice('RBTCUSDT', 50000);
  const twoDaysAgoNs = (Date.now() - 2 * 86400 * 1000) * 1e6;
  const marketId = listEtf('RBTC3L/RUSD', 'RBTC', 50000, twoDaysAgoNs);

  const result = settlement.rebalanceEtfTokens();
  assert.ok(result.includes('RBTC3L/RUSD'));

  const row = db.prepare('SELECT nav, reference_price, last_rebalance_ns FROM etf_markets WHERE market_id = ?').get(marketId);
  assert.equal(row.nav, 50000);
  assert.equal(row.reference_price, 50000);
  assert.ok(row.last_rebalance_ns > twoDaysAgoNs);
});

test('a token rebalanced moments ago is not rebalanced again', () => {
  setPrice('RETHUSDT', 3000);
  const justNowNs = Date.now() * 1e6;
  listEtf('RETH3L/RUSD', 'RETH', 3000, justNowNs);

  const result = settlement.rebalanceEtfTokens();
  assert.ok(!result.includes('RETH3L/RUSD'));
});

// ---------------------------------------------------------------------------
// Full cycle
// ---------------------------------------------------------------------------

test('a full settlement cycle reports each venue it touched', () => {
  const symbol = listPerp('FCYCLE', 1000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 1, leverage: 10 });

  setPrice('RCYCLEUSDT', 100);
  const twoDaysAgoNs = (Date.now() - 2 * 86400 * 1000) * 1e6;
  listEtf('RCYCLE3L/RUSD', 'RCYCLE', 100, twoDaysAgoNs);

  const report = settlement.runSettlementCycle();
  assert.ok(report.fundingApplied.some((entry) => entry.symbol === symbol));
  assert.ok(report.etfRebalanced.includes('RCYCLE3L/RUSD'));
  assert.ok(Array.isArray(report.optionsSettled));
});
