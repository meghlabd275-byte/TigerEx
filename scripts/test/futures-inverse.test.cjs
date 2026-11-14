'use strict';
/**
 * Inverse (`COIN_M`) contracts settle in the base coin, not a stablecoin, so
 * their margin, P&L and fees must be computed differently from a linear
 * contract. Before this was fixed the engine ran inverse positions through the
 * linear formulas, which credited a winning short an astronomically wrong
 * amount of coin. These tests read the real balances the engine wrote.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-inverse-')), 'inverse.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const {
  placeFuturesOrder,
  closePosition,
  markPriceFor,
} = require('../../.test-build/futures-engine.js');

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

let seq = 0;
/** List an inverse BTC-margined contract with a unique symbol. */
function inverseContract(price) {
  seq += 1;
  const symbol = `BTC${seq}/USD`;
  db.prepare(
    `INSERT INTO futures_markets
       (market_id, symbol, base_asset, quote_asset, settlement_asset, contract_type, listing_type,
        contract_size, tick_size, min_quantity, max_quantity, max_leverage, maker_fee_bps, taker_fee_bps,
        funding_interval_hours, funding_rate_cap, maintenance_margin_rate, initial_margin_rate,
        liquidation_fee_rate, insurance_fund_share, status)
     VALUES (?, ?, 'BTC', 'USD', 'BTC', 'COIN_M', 'perpetual', 1, 0.1, 1, 100000000, 125, 2, 5,
             8, 0.01, 0.005, 0.008, 0.005, 0.1, 'active')`,
  ).run(generateId(), symbol);
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

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('an inverse short is margined and charged its fee in coin, not USD', () => {
  const symbol = inverseContract(50000);
  assert.equal(markPriceFor(symbol), 50000);
  const user = seedUser();
  credit(user, 'BTC', 10);

  // 10,000 USD of contracts at price 50,000 is 0.2 BTC of value; at 10x the
  // margin is 0.02 BTC and the 5 bps taker fee is 0.0001 BTC.
  const result = placeFuturesOrder(user, {
    symbol,
    side: 'sell',
    type: 'market',
    quantity: 10000,
    leverage: 10,
  });

  assert.equal(result.action, 'opened');
  assert.ok(near(Number(result.position.margin), 0.02, 1e-12), `margin ${result.position.margin}`);
  assert.ok(near(lockedBalance(user, 'BTC'), 0.02, 1e-12), `locked ${lockedBalance(user, 'BTC')}`);
  assert.ok(near(availableBalance(user, 'BTC'), 10 - 0.02 - 0.0001, 1e-12), `available ${availableBalance(user, 'BTC')}`);
});

test('an inverse short gains coin as the price falls, and closing moves real balances', () => {
  const symbol = inverseContract(50000);
  const user = seedUser();
  credit(user, 'BTC', 10);

  const opened = placeFuturesOrder(user, {
    symbol,
    side: 'sell',
    type: 'market',
    quantity: 10000,
    leverage: 10,
  });

  setOraclePrice(symbol, 40000);
  const closed = closePosition(user, opened.position.positionId);

  // Short 10,000 USD at 50,000 and buy it back at 40,000: 10000 * (1/40000 -
  // 1/50000) = 0.05 BTC of profit. A linear formula would have credited
  // 100,000,000 BTC.
  assert.ok(near(closed.realizedPnl, 0.05 - 0.000125, 1e-12), `realized ${closed.realizedPnl}`);

  // Start 10; open locks 0.02 and pays a 0.0001 fee; close releases the margin,
  // pays +0.05 profit, and charges 0.000125 fee.
  const expected = 10 - 0.02 - 0.0001 + 0.02 + 0.05 - 0.000125;
  assert.ok(near(availableBalance(user, 'BTC'), expected, 1e-12), `available ${availableBalance(user, 'BTC')}`);
  assert.ok(near(lockedBalance(user, 'BTC'), 0, 1e-12), `locked ${lockedBalance(user, 'BTC')}`);
});

test('an inverse long loses coin as the price falls, capped at its margin', () => {
  const symbol = inverseContract(50000);
  const user = seedUser();
  credit(user, 'BTC', 10);

  const opened = placeFuturesOrder(user, {
    symbol,
    side: 'buy',
    type: 'market',
    quantity: 10000,
    leverage: 10,
  });

  setOraclePrice(symbol, 40000);
  const closed = closePosition(user, opened.position.positionId);

  // Long 10,000 USD: 10000 * (1/50000 - 1/40000) = -0.05 BTC, less the
  // 0.000125 BTC close fee.
  assert.ok(near(closed.realizedPnl, -0.05 - 0.000125, 1e-12), `realized ${closed.realizedPnl}`);
  const expected = 10 - 0.02 - 0.0001 + 0.02 - 0.05 - 0.000125;
  assert.ok(near(availableBalance(user, 'BTC'), expected, 1e-12), `available ${availableBalance(user, 'BTC')}`);
});
