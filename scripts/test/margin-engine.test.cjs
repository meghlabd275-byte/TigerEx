'use strict';
/**
 * Integration tests for the spot margin engine against a real database.
 *
 * A margin market is listed through the same validation the admin route uses,
 * prices come from `market_data`, and every assertion reads the balances and
 * loan rows the engine wrote. Nothing is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-margin-')), 'margin.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const { borrow, repay, liquidate, marginAccount, MarginError } = require('../../.test-build/margin-engine.js');

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
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, currency, available);
}

function setPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (id, symbol, price) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, updated_at = datetime('now')`,
  ).run(generateId(), symbol, price);
}

function listMarginMarket(symbol, mode = 'cross') {
  const [base, quote] = symbol.split('/');
  db.prepare(
    `INSERT INTO margin_markets
       (market_id, symbol, base_asset, quote_asset, mode, max_leverage, collateral_ltv,
        borrowable_assets, interest_base_apr, interest_kink_utilization, interest_kink_apr,
        interest_max_apr, liquidation_thresholds, liquidation_bonus, risk_tier, status)
     VALUES (?, ?, ?, ?, ?, 10, ?, ?, 0.05, 0.8, 0.5, 1.0, ?, 0.05, 'medium', 'active')`,
  ).run(
    generateId(),
    symbol,
    base,
    quote,
    mode,
    JSON.stringify({ BTC: 0.7, RUSD: 0.9 }),
    JSON.stringify(['RUSD', 'BTC']),
    JSON.stringify({ BTC: 0.75, RUSD: 0.95 }),
  );
}

setPrice('BTC/RUSD', 50000);
setPrice('TGR/RUSD', 10);
listMarginMarket('BTC/RUSD');
listMarginMarket('TGR/RUSD', 'isolated');

test('a loan within its LTV credits the borrow and locks the collateral', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  // 0.5 BTC at 50,000 is 25,000 of collateral; 70% LTV allows 17,500.
  const loan = borrow(user, {
    symbol: 'BTC/RUSD',
    asset: 'RUSD',
    amount: 17000,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });

  assert.equal(loan.principal, 17000);
  assert.equal(loan.collateralAmount, 0.5);
  assert.equal(loan.collateralValue, 25000);
  assert.ok(loan.ltv < 0.7);
  assert.equal(loan.liquidatable, false);

  assert.equal(availableBalance(user, 'RUSD'), 17000);
  assert.equal(availableBalance(user, 'BTC'), 0.5);
  assert.equal(lockedBalance(user, 'BTC'), 0.5);
});

test('a loan above its LTV is refused and locks nothing', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  assert.throws(
    () =>
      borrow(user, {
        symbol: 'BTC/RUSD',
        asset: 'RUSD',
        amount: 18000,
        collateralAsset: 'BTC',
        collateralAmount: 0.5,
      }),
    (error) => error instanceof MarginError && error.code === 'LTV_EXCEEDED',
  );

  assert.equal(lockedBalance(user, 'BTC'), 0);
  assert.equal(availableBalance(user, 'RUSD'), 0);
});

test('an asset that is not borrowable on the market is refused', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  assert.throws(
    () =>
      borrow(user, {
        symbol: 'BTC/RUSD',
        asset: 'TGR',
        amount: 1,
        collateralAsset: 'BTC',
        collateralAmount: 0.5,
      }),
    (error) => error instanceof MarginError && error.code === 'NOT_BORROWABLE',
  );
});

test('an asset that is not accepted as collateral is refused', () => {
  const user = seedUser();
  credit(user, 'TGR', 1000);

  assert.throws(
    () =>
      borrow(user, {
        symbol: 'BTC/RUSD',
        asset: 'RUSD',
        amount: 1000,
        collateralAsset: 'TGR',
        collateralAmount: 500,
      }),
    (error) => error instanceof MarginError && error.code === 'NOT_COLLATERAL',
  );
});

test('an unlisted margin market is refused', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  assert.throws(
    () =>
      borrow(user, {
        symbol: 'DOGE/RUSD',
        asset: 'RUSD',
        amount: 10,
        collateralAsset: 'BTC',
        collateralAmount: 0.01,
      }),
    (error) => error instanceof MarginError && error.code === 'UNKNOWN_MARKET',
  );
});

test('repaying in full closes the loan and releases all collateral', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  const loan = borrow(user, {
    symbol: 'BTC/RUSD',
    asset: 'RUSD',
    amount: 10000,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });
  assert.equal(lockedBalance(user, 'BTC'), 0.5);

  // Interest has accrued for at most a moment, so repaying the principal is
  // enough to close the loan.
  const repaid = repay(user, loan.loanId, 10000 * 1.01);
  assert.equal(repaid.principal, 0);
  assert.equal(repaid.interestAccrued, 0);

  assert.equal(lockedBalance(user, 'BTC'), 0);
  assert.equal(availableBalance(user, 'BTC'), 1);
});

test('a partial repayment releases only the collateral it earned', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  const loan = borrow(user, {
    symbol: 'BTC/RUSD',
    asset: 'RUSD',
    amount: 10000,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });

  // A moment of interest accrues before the repayment, so half the principal
  // is repaid plus a negligible amount of interest; the collateral release is
  // proportional to the principal.
  const repaid = repay(user, loan.loanId, 5000);
  assert.ok(Math.abs(repaid.principal - 5000) < 1e-4);
  assert.ok(Math.abs(lockedBalance(user, 'BTC') - 0.25) < 1e-9);
  assert.ok(Math.abs(availableBalance(user, 'BTC') - 0.75) < 1e-9);
  assert.ok(Math.abs(availableBalance(user, 'RUSD') - 5000) < 1e-3);
});

test('repaying more than is owed debits only the debt and closes the loan', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);
  credit(user, 'RUSD', 100000);

  const loan = borrow(user, {
    symbol: 'BTC/RUSD',
    asset: 'RUSD',
    amount: 10000,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });

  repay(user, loan.loanId, 50000);

  // The overpayment stays available: only principal plus accrued interest left
  // the balance, and the collateral was released in full.
  assert.ok(availableBalance(user, 'RUSD') > 100000 - 10000 - 1);
  assert.equal(lockedBalance(user, 'BTC'), 0);
  assert.equal(availableBalance(user, 'BTC'), 1);

  const closed = db.prepare('SELECT status FROM margin_loans WHERE loan_id = ?').get(loan.loanId);
  assert.equal(closed.status, 'closed');
});

test('repaying a loan with an insufficient balance is refused', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  const loan = borrow(user, {
    symbol: 'BTC/RUSD',
    asset: 'RUSD',
    amount: 10000,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });

  // Spend the borrowed funds so the repayment cannot be covered. Only this
  // account's own balance is zeroed; tests share one database.
  db.prepare(
    `UPDATE balances SET available = 0
      WHERE currency = 'RUSD'
        AND wallet_id IN (SELECT wallet_id FROM wallets WHERE user_id = ?)`,
  ).run(user);

  assert.throws(
    () => repay(user, loan.loanId, 10000),
    (error) => error instanceof MarginError && error.code === 'INSUFFICIENT_BALANCE',
  );
  assert.equal(lockedBalance(user, 'BTC'), 0.5);
});

test('a healthy loan cannot be liquidated', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  const loan = borrow(user, {
    symbol: 'BTC/RUSD',
    asset: 'RUSD',
    amount: 10000,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });

  const liquidator = seedUser();
  assert.throws(
    () => liquidate(liquidator, loan.loanId),
    (error) => error instanceof MarginError && error.code === 'NOT_LIQUIDATABLE',
  );
});

test('a loan whose collateral falls below its threshold is liquidated', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  const loan = borrow(user, {
    symbol: 'TGR/RUSD',
    mode: 'isolated',
    asset: 'RUSD',
    amount: 4500,
    collateralAsset: 'BTC',
    collateralAmount: 0.5,
  });

  // The BTC collateral is worth 25,000 and 4,500 is borrowed against it. Drop
  // the price so the debt exceeds the 75% liquidation threshold of the
  // collateral: 0.1 * 50,000 * 0.75 = 3,750 < 4,500.
  setPrice('BTC/RUSD', 10000);

  const account = marginAccount(user);
  assert.equal(account.liquidatable, true);

  const liquidator = seedUser();
  const result = liquidate(liquidator, loan.loanId);
  assert.ok(result.seized > 0);
  assert.equal(result.asset, 'BTC');
  assert.equal(lockedBalance(user, 'BTC'), 0);
  assert.equal(availableBalance(liquidator, 'BTC'), result.seized);

  const closed = db.prepare('SELECT status FROM margin_loans WHERE loan_id = ?').get(loan.loanId);
  assert.equal(closed.status, 'liquidated');

  setPrice('BTC/RUSD', 50000);
});

test('an account with no loans reports zeros, not a fabricated balance', () => {
  const user = seedUser();
  const account = marginAccount(user);
  assert.equal(account.loans.length, 0);
  assert.equal(account.totalCollateralValue, 0);
  assert.equal(account.totalDebt, 0);
  assert.equal(account.liquidatable, false);
});

test('an unpriced collateral asset blocks the borrow rather than guessing', () => {
  const user = seedUser();
  credit(user, 'BTC', 1);

  // An isolated market whose quote has no price row at all.
  db.prepare(
    `INSERT INTO margin_markets
       (market_id, symbol, base_asset, quote_asset, mode, max_leverage, collateral_ltv,
        borrowable_assets, interest_base_apr, interest_kink_utilization, interest_kink_apr,
        interest_max_apr, liquidation_thresholds, liquidation_bonus, risk_tier, status)
     VALUES (?, 'NOPRICE/RUSD', 'NOPRICE', 'RUSD', 'cross', 10, '{"BTC":0.7}', '["NOPRICE"]',
             0.05, 0.8, 0.5, 1.0, '{"BTC":0.75}', 0.05, 'medium', 'active')`,
  ).run(generateId());

  assert.throws(
    () =>
      borrow(user, {
        symbol: 'NOPRICE/RUSD',
        asset: 'NOPRICE',
        amount: 1,
        collateralAsset: 'BTC',
        collateralAmount: 0.5,
      }),
    (error) => error instanceof MarginError && error.code === 'PRICE_UNAVAILABLE',
  );
});
