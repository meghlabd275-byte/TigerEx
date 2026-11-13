'use strict';
/**
 * Every engine that moves a user balance must write the authoritative journal.
 *
 * Spot and futures already do; margin lending, leveraged tokens (ETF), options
 * and earn rewards each move real balances too. Each test drives the real engine
 * against a real database and then asserts `reconcileJournal` still agrees, so a
 * settlement path that forgot to journal is caught here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-jcov-')), 'jcov.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { recordDeposit, reconcileJournal } = require('../../.test-build/accounting.js');
const marginEngine = require('../../.test-build/margin-engine.js');
const etfEngine = require('../../.test-build/etf-engine.js');
const optionsEngine = require('../../.test-build/options-engine.js');
const subscriptions = require('../../.test-build/subscriptions.js');

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

/** Fund a user and journal the deposit, so the opening balance reconciles. */
function fund(userId, currency, amount) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(
    'INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)',
  ).run(generateId(), walletId, currency, amount);
  recordDeposit(userId, currency, amount, 'seed');
}

function setPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (id, symbol, price) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price`,
  ).run(generateId(), symbol, price);
}

function assertReconciles(label) {
  const recon = reconcileJournal();
  assert.equal(recon.chain.ok, true, `${label}: journal chain broken`);
  for (const entry of recon.entries) {
    assert.equal(entry.ok, true, `${label}: ${entry.asset} drift ${entry.difference}`);
  }
}

// ---------------------------------------------------------------------------
// Margin lending
// ---------------------------------------------------------------------------

// The margin engine prices from the pair symbol; ETF and options price their
// underlying through `usdPrice`, which reads `<ASSET>USDT`.
setPrice('BTC/RUSD', 50000);
setPrice('BTCUSDT', 50000);
db.prepare(
  `INSERT INTO margin_markets
     (market_id, symbol, base_asset, quote_asset, mode, max_leverage, collateral_ltv,
      borrowable_assets, interest_base_apr, interest_kink_utilization, interest_kink_apr,
      interest_max_apr, liquidation_thresholds, liquidation_bonus, risk_tier, status)
   VALUES (?, 'BTC/RUSD', 'BTC', 'RUSD', 'cross', 10, ?, ?, 0.05, 0.8, 0.5, 1.0, ?, 0.05, 'medium', 'active')`,
).run(
  generateId(),
  JSON.stringify({ BTC: 0.7, RUSD: 0.9 }),
  JSON.stringify(['RUSD', 'BTC']),
  JSON.stringify({ BTC: 0.75, RUSD: 0.95 }),
);

test('a margin borrow and repay reconcile', () => {
  const user = seedUser();
  fund(user, 'BTC', 1);

  const loan = marginEngine.borrow(user, {
    symbol: 'BTC/RUSD',
    asset: 'RUSD',
    amount: 17000,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });
  assertReconciles('after borrow');

  marginEngine.repay(user, loan.loanId, 17000);
  assertReconciles('after repay');
});

test('a margin liquidation reconciles', () => {
  const user = seedUser();
  fund(user, 'BTC', 1);

  const loan = marginEngine.borrow(user, {
    symbol: 'BTC/RUSD',
    asset: 'RUSD',
    amount: 17000,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });

  // Collapse the collateral price so the loan is liquidatable.
  setPrice('BTC/RUSD', 30000);
  const liquidator = seedUser();
  marginEngine.liquidate(liquidator, loan.loanId);
  assertReconciles('after liquidation');
  // Restore the price for any later test.
  setPrice('BTC/RUSD', 50000);
});

// ---------------------------------------------------------------------------
// Leveraged tokens (ETF)
// ---------------------------------------------------------------------------

setPrice('BTCUSDT', 50000);
db.prepare(
  `INSERT INTO etf_markets
     (market_id, symbol, underlying, settlement_asset, leverage, direction, nav, reference_price, last_rebalance_ns, status)
   VALUES (?, 'BTC3L', 'BTC', 'RUSD', 3, 'long', 100, 50000, ?, 'active')`,
).run(generateId(), Date.now() * 1e6);

test('an ETF subscribe and redeem reconcile', () => {
  const user = seedUser();
  fund(user, 'RUSD', 10000);

  const position = etfEngine.subscribe({ userId: user, symbol: 'BTC3L', amount: 1000 });
  assert.ok(position.tokens > 0);
  assertReconciles('after ETF subscribe');

  etfEngine.redeem({ userId: user, symbol: 'BTC3L', tokens: position.tokens });
  assertReconciles('after ETF redeem');
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

setPrice('BTCUSDT', 50000);
db.prepare(
  `INSERT INTO options_markets
     (market_id, symbol, underlying, settlement_asset, option_type, strike_price, expiry_ns,
      exercise_style, contract_size, tick_size, min_quantity, max_quantity, taker_fee_bps, status)
   VALUES (?, 'BTC-50000-C', 'BTC', 'RUSD', 'call', 50000, ?, 'european', 1, 0.01, 1, 100000, 5, 'active')`,
).run(generateId(), (Date.now() + 30 * 24 * 3600 * 1000) * 1e6);

test('an options open and close reconcile', () => {
  const user = seedUser();
  fund(user, 'RUSD', 100000);

  optionsEngine.openPosition({ userId: user, symbol: 'BTC-50000-C', side: 'long', quantity: 1 });
  assertReconciles('after options open');

  optionsEngine.closePosition({ userId: user, symbol: 'BTC-50000-C', side: 'long' });
  assertReconciles('after options close');
});

// ---------------------------------------------------------------------------
// Earn rewards
// ---------------------------------------------------------------------------

const earnProductId = generateId();
db.prepare(
  `INSERT INTO earn_products (product_id, name, product_type, asset, apy, duration_days, min_amount, status, params)
   VALUES (?, 'RUSD flexible', 'flexible', 'RUSD', 0.5, NULL, 10, 'active', NULL)`,
).run(earnProductId);

test('a funded earn reward payout reconciles', () => {
  const user = seedUser();
  fund(user, 'RUSD', 10000);
  subscriptions.fundEarnRewards('RUSD', 500);

  const subscription = subscriptions.subscribe({ userId: user, productId: earnProductId, amount: 1000 });
  db.prepare("UPDATE earn_subscriptions SET started_at = datetime('now', '-400 days') WHERE subscription_id = ?").run(
    subscription.subscriptionId,
  );
  const result = subscriptions.redeem(user, subscription.subscriptionId);
  assert.ok(result.reward > 0);
  assertReconciles('after earn redeem');
});
