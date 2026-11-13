'use strict';
/**
 * Futures settlement must be in the authoritative journal.
 *
 * A perpetual's fee, realised PnL, funding and liquidation all move balances.
 * If any is left out, the journal's net user holding drifts from the ledger and
 * reconciliation reports it. These tests open, close, fund and liquidate real
 * positions, then assert `reconcileJournal` still agrees.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-jfut-')), 'jfut.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const { recordDeposit, reconcileJournal } = require('../../.test-build/accounting.js');
const { accountBalance, userAccount } = require('../../.test-build/journal.js');
const { placeFuturesOrder, closePosition, applyFunding, listPositions } = require('../../.test-build/futures-engine.js');
const { scanPositions, processQueue } = require('../../.test-build/risk-supervisor.js');
const { runAdl } = require('../../.test-build/adl.js');

const db = getDb();

const reset = () => {
  for (const table of [
    'journal_legs',
    'journal_entries',
    'liquidation_queue',
    'futures_conditional_orders',
    'funding_rates',
    'futures_positions',
    'futures_markets',
    'insurance_funds',
    'oracle_prices',
    'oracle_sources',
    'balances',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
};

function seedUser() {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, 'active')`).run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
  );
  return userId;
}

/** Fund a user and journal the deposit, so the opening balance reconciles. */
function fund(userId, asset, amount) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, asset);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, asset, amount);
  recordDeposit(userId, asset, amount, 'seed');
}

let seq = 0;
function pricedContract(base, price, overrides = {}) {
  seq += 1;
  const symbol = `${base}${seq}/RUSD`;
  const [asset, quote] = symbol.split('/');
  db.prepare(
    `INSERT INTO futures_markets
       (market_id, symbol, base_asset, quote_asset, settlement_asset, contract_type, listing_type,
        contract_size, tick_size, min_quantity, max_quantity, max_leverage, maker_fee_bps, taker_fee_bps,
        funding_interval_hours, funding_rate_cap, maintenance_margin_rate, initial_margin_rate,
        liquidation_fee_rate, insurance_fund_share, status)
     VALUES (?, ?, ?, ?, ?, 'RUSD_M', 'perpetual', 1, ?, 0.001, 1000000, ?, 2, 5, 8, 0.01, ?, ?, 0.005, 0.1, 'active')`,
  ).run(
    generateId(),
    symbol,
    asset,
    quote,
    overrides.settlement ?? quote,
    overrides.tickSize ?? 0.1,
    overrides.maxLeverage ?? 125,
    overrides.maintenanceMarginRate ?? 0.005,
    overrides.initialMarginRate ?? 0.008,
  );
  for (const name of ['chainlink', 'pyth']) {
    db.prepare(
      `INSERT INTO oracle_sources (source_id, symbol, source_name, weight, max_deviation, status)
       VALUES (?, ?, ?, 1, 0.05, 'active')`,
    ).run(generateId(), symbol, name);
    db.prepare(
      `INSERT INTO oracle_prices (price_id, symbol, source_name, price, confidence, published_ns)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(generateId(), symbol, name, price, Date.now() * 1_000_000);
  }
  return symbol;
}

function setOraclePrice(symbol, price) {
  db.prepare('UPDATE oracle_prices SET price = ?, published_ns = ? WHERE symbol = ?').run(
    price,
    Date.now() * 1_000_000,
    symbol,
  );
}

function assertReconciles(label) {
  const recon = reconcileJournal();
  assert.equal(recon.chain.ok, true, `${label}: chain broken`);
  for (const entry of recon.entries) {
    assert.equal(entry.ok, true, `${label}: ${entry.asset} drift ${entry.difference}`);
  }
}

test('an open fee and a profitable close reconcile', () => {
  reset();
  const symbol = pricedContract('JBTC', 50000);
  const user = seedUser();
  fund(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 0.1, leverage: 10 });
  assertReconciles('after open');
  assert.ok(accountBalance('fees') > 0, 'the open fee reached the fee account');

  setOraclePrice(symbol, 60000);
  const position = listPositions(user, symbol)[0];
  closePosition(user, position.position_id);
  assertReconciles('after close');

  // A winning long is paid from the venue pool, so the pool is net short.
  assert.ok(accountBalance(`futures_pool:${symbol}`) < 0);
});

test('a losing close is banked into the venue pool', () => {
  reset();
  const symbol = pricedContract('JETH', 3000);
  const user = seedUser();
  fund(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 1, leverage: 5 });
  setOraclePrice(symbol, 2900);
  const position = listPositions(user, symbol)[0];
  closePosition(user, position.position_id);
  assertReconciles('after losing close');
  assert.ok(accountBalance(`futures_pool:${symbol}`) > 0);
});

test('funding between a long and a short reconciles', () => {
  reset();
  const symbol = pricedContract('JSOL', 100, { tickSize: 0.0001 });
  const long = seedUser();
  const short = seedUser();
  fund(long, 'RUSD', 100000);
  fund(short, 'RUSD', 100000);

  placeFuturesOrder(long, { symbol, side: 'buy', type: 'market', quantity: 10, leverage: 5 });
  placeFuturesOrder(short, { symbol, side: 'sell', type: 'market', quantity: 10, leverage: 5 });

  // Push the mark above the index so the funding rate is non-zero and one side
  // pays the other.
  setOraclePrice(symbol, 101);
  applyFunding(symbol, 100);
  assertReconciles('after funding');

  // Funding is zero-sum between the two users: their journal holdings still add
  // to their ledger balances, and no value was minted.
  const journalSum = accountBalance(userAccount(long)) + accountBalance(userAccount(short));
  const ledgerSum = availableBalance(long, 'RUSD') + lockedBalance(long, 'RUSD')
    + availableBalance(short, 'RUSD') + lockedBalance(short, 'RUSD');
  assert.ok(Math.abs(journalSum - ledgerSum) < 1e-6);
});

test('a liquidation reconciles and books the seized margin', () => {
  reset();
  const symbol = pricedContract('JADA', 100, { tickSize: 0.0001, maintenanceMarginRate: 0.005 });
  const user = seedUser();
  fund(user, 'RUSD', 1000);

  // A high-leverage long that a sharp drop puts underwater.
  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 10, leverage: 100 });
  const before = lockedBalance(user, 'RUSD');
  assert.ok(before > 0);

  setOraclePrice(symbol, 90);
  scanPositions();
  const processed = processQueue();
  assert.equal(processed.processed.length, 1, 'the position was liquidated');
  assertReconciles('after liquidation');

  // The margin is gone from the user's locked balance and the journal agrees.
  assert.equal(lockedBalance(user, 'RUSD'), 0);
  assert.ok(accountBalance(`insurance:${symbol}`) !== 0 || accountBalance(`futures_pool:${symbol}`) !== 0);
});

test('an auto-deleverage reconciles', () => {
  reset();
  const symbol = pricedContract('JADL', 100, { tickSize: 0.0001 });
  const long = seedUser();
  const short = seedUser();
  fund(long, 'RUSD', 100000);
  fund(short, 'RUSD', 100000);

  placeFuturesOrder(long, { symbol, side: 'buy', type: 'market', quantity: 10, leverage: 10 });
  placeFuturesOrder(short, { symbol, side: 'sell', type: 'market', quantity: 10, leverage: 10 });
  // The short is profitable when the mark falls.
  setOraclePrice(symbol, 90);

  db.prepare(
    `INSERT INTO insurance_funds (contract, balance, target_balance, fee_share, adl_enabled, adl_threshold)
     VALUES (?, 50, 1000, 0.1, 1, 500)
     ON CONFLICT(contract) DO UPDATE SET balance = 50, target_balance = 1000, adl_enabled = 1, adl_threshold = 500`,
  ).run(symbol);

  const result = runAdl(symbol);
  assert.equal(result.ran, true);
  assert.ok(result.clawedBack > 0);
  assertReconciles('after ADL');
});
