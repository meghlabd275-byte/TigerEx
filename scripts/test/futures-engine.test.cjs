'use strict';
/**
 * Integration tests for the perpetual futures engine against a real database.
 *
 * A contract is listed with the same shape the admin route writes, the mark
 * price comes from the oracle aggregation path, and every assertion reads the
 * balances and position rows the engine wrote.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-futures-')), 'futures.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const {
  placeFuturesOrder,
  setLeverage,
  applyFunding,
  listPositions,
  markPriceFor,
  riskTiers,
  FuturesError,
} = require('../../.test-build/futures-engine.js');
const { scanPositions, processQueue } = require('../../.test-build/risk-supervisor.js');

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

let contractSeq = 0;

/**
 * List a contract under a symbol unique to the calling test.
 *
 * Each test trades its own contract so a position or funding row left by one
 * test can never change another test's book.
 */
function uniqueContract(base, overrides = {}) {
  contractSeq += 1;
  const symbol = `${base}${contractSeq}/RUSD`;
  const [asset, quote] = symbol.split('/');
  db.prepare(
    `INSERT INTO futures_markets
       (market_id, symbol, base_asset, quote_asset, settlement_asset, contract_type, listing_type,
        contract_size, tick_size, min_quantity, max_quantity, max_leverage, maker_fee_bps, taker_fee_bps,
        funding_interval_hours, funding_rate_cap, maintenance_margin_rate, initial_margin_rate,
        liquidation_fee_rate, insurance_fund_share, status)
     VALUES (?, ?, ?, ?, ?, 'RUSD_M', 'perpetual', 1, ?, ?, 1000000, ?, 2, 5, 8, 0.01, 0.005, 0.008, 0.005, 0.1, 'active')`,
  ).run(
    generateId(),
    symbol,
    asset,
    quote,
    overrides.settlement ?? quote,
    overrides.tickSize ?? 0.1,
    overrides.minQuantity ?? 0.001,
    overrides.maxLeverage ?? 125,
  );
  return symbol;
}

/** Register oracle sources so the index can be published for a symbol. */
function listOracle(symbol, prices) {
  for (const [name, price] of Object.entries(prices)) {
    db.prepare(
      `INSERT INTO oracle_sources (source_id, symbol, source_name, weight, max_deviation, status)
       VALUES (?, ?, ?, 1, 0.05, 'active')`,
    ).run(generateId(), symbol, name);
    db.prepare(
      `INSERT INTO oracle_prices (price_id, symbol, source_name, price, confidence, published_ns)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(generateId(), symbol, name, price, Date.now() * 1_000_000);
  }
}

/** Republish every oracle source for a symbol at a new price. */
function setOraclePrice(symbol, price) {
  db.prepare('UPDATE oracle_prices SET price = ?, published_ns = ? WHERE symbol = ?').run(
    price,
    Date.now() * 1_000_000,
    symbol,
  );
}

/** List a contract with two oracle sources at the same price. */
function pricedContract(base, price, overrides = {}) {
  const symbol = uniqueContract(base, overrides);
  listOracle(symbol, { chainlink: price, pyth: price });
  return symbol;
}

test('the mark price is the aggregated index, not a stored constant', () => {
  const symbol = pricedContract('MBTC', 50000);
  assert.equal(markPriceFor(symbol), 50000);
  assert.equal(markPriceFor('NOT/LISTED'), null);
});

test('a market buy opens a long with the margin its leverage requires', () => {
  const symbol = pricedContract('LBTC', 50000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  const result = placeFuturesOrder(user, {
    symbol,
    side: 'buy',
    type: 'market',
    quantity: 0.1,
    leverage: 10,
  });

  assert.equal(result.action, 'opened');
  assert.equal(result.position.side, 'long');
  assert.equal(result.position.quantity, 0.1);
  assert.equal(result.position.entryPrice, 50000);
  assert.equal(result.position.leverage, 10);

  // 0.1 BTC at 50,000 is 5,000 notional; 10x leverage locks 500 margin.
  assert.equal(lockedBalance(user, 'RUSD'), 500);
  assert.ok(availableBalance(user, 'RUSD') < 99500);
});

test('a short and a long are tracked separately in hedge mode', () => {
  const symbol = pricedContract('HETH', 3000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, {
    symbol,
    side: 'buy',
    positionSide: 'long',
    type: 'market',
    quantity: 1,
    leverage: 10,
  });
  placeFuturesOrder(user, {
    symbol,
    side: 'sell',
    positionSide: 'short',
    type: 'market',
    quantity: 1,
    leverage: 10,
  });

  const positions = listPositions(user, symbol);
  assert.equal(positions.length, 2);
  assert.deepEqual(
    positions.map((p) => p.side).sort(),
    ['long', 'short'],
  );
});

test('a second order in the same direction increases the position and averages the entry', () => {
  const symbol = pricedContract('ATGR', 10, { tickSize: 0.0001, minQuantity: 1 });
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 100, leverage: 5 });

  // Move the index so the second fill lands at a different price.
  setOraclePrice(symbol, 20);
  const result = placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 100, leverage: 5 });

  assert.equal(result.action, 'increased');
  assert.equal(result.position.quantity, 200);
  assert.equal(result.position.entryPrice, 15);
});

test('a reduce-only order without a position is refused', () => {
  const symbol = pricedContract('RSOL', 100);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  assert.throws(
    () =>
      placeFuturesOrder(user, {
        symbol,
        side: 'sell',
        type: 'market',
        quantity: 1,
        reduceOnly: true,
      }),
    (error) => error instanceof FuturesError && error.code === 'NO_POSITION',
  );
});

test('closing a profitable long returns margin plus profit', () => {
  const symbol = pricedContract('PSOL', 100);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 10, leverage: 10 });
  // 10 SOL at 100 is 1,000 notional; 10x locks 100.
  assert.equal(lockedBalance(user, 'RUSD'), 100);
  const afterOpen = availableBalance(user, 'RUSD');

  // The index rises to 120, so the long is up 200.
  setOraclePrice(symbol, 120);

  const closed = placeFuturesOrder(user, {
    symbol,
    side: 'sell',
    type: 'market',
    quantity: 10,
    reduceOnly: true,
  });

  assert.equal(closed.action, 'closed');
  assert.equal(closed.position.status, 'closed');
  assert.ok(closed.realizedPnl > 199);
  assert.equal(lockedBalance(user, 'RUSD'), 0);
  // Margin came back plus the profit, less the taker fee.
  assert.ok(availableBalance(user, 'RUSD') > afterOpen + 100 + 190);
});

test('a partially reduced position keeps the rest open', () => {
  const symbol = pricedContract('RBTC', 50000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 0.2, leverage: 10 });
  assert.equal(lockedBalance(user, 'RUSD'), 1000);

  const reduced = placeFuturesOrder(user, {
    symbol,
    side: 'sell',
    type: 'market',
    quantity: 0.1,
    reduceOnly: true,
  });

  assert.equal(reduced.action, 'reduced');
  assert.equal(reduced.position.quantity, 0.1);
  assert.equal(reduced.position.status, 'open');
  assert.equal(lockedBalance(user, 'RUSD'), 500);
});

test('an order without enough margin is refused and locks nothing', () => {
  const symbol = pricedContract('IBTC', 50000);
  const user = seedUser();
  credit(user, 'RUSD', 100);

  assert.throws(
    () =>
      placeFuturesOrder(user, {
        symbol,
        side: 'buy',
        type: 'market',
        quantity: 0.1,
        leverage: 10,
      }),
    (error) => error instanceof FuturesError && error.code === 'INSUFFICIENT_MARGIN',
  );
  assert.equal(lockedBalance(user, 'RUSD'), 0);
});

test('a price that is not a tick multiple is refused', () => {
  const symbol = pricedContract('TBTC', 50000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  assert.throws(
    () =>
      placeFuturesOrder(user, {
        symbol,
        side: 'buy',
        type: 'limit',
        price: 50000.05,
        quantity: 0.01,
        leverage: 10,
      }),
    (error) => error instanceof FuturesError && error.code === 'INVALID_TICK',
  );
});

test('a contract with no publishable index is refused rather than priced from a guess', () => {
  const symbol = uniqueContract('NOPRICE');
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  assert.equal(markPriceFor(symbol), null);
  assert.throws(
    () => placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 1, leverage: 10 }),
    (error) => error instanceof FuturesError && error.code === 'NO_MARK_PRICE',
  );
});

test('a risk tier caps leverage and sets the maintenance margin', () => {
  const symbol = pricedContract('TETH', 3000);
  db.prepare(
    `INSERT INTO risk_limits (limit_id, symbol, tier, max_position_notional, max_leverage, maintenance_margin_rate)
     VALUES (?, ?, 1, 10000, 20, 0.01), (?, ?, 2, 1000000, 10, 0.02)`,
  ).run(generateId(), symbol, generateId(), symbol);

  assert.equal(riskTiers(symbol).length, 2);

  const user = seedUser();
  credit(user, 'RUSD', 1000000);

  // 1 ETH at 3,000 falls in tier 1, so leverage above 20 is capped to 20.
  const result = placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 1, leverage: 100 });
  assert.equal(result.position.leverage, 20);
  assert.equal(lockedBalance(user, 'RUSD'), 150);
});

test('raising leverage on a position releases the margin it no longer needs', () => {
  const symbol = pricedContract('LSOL', 100);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 10, leverage: 5 });
  assert.equal(lockedBalance(user, 'RUSD'), 200);

  const updated = setLeverage(user, symbol, 10);
  assert.equal(updated.leverage, 10);
  assert.equal(lockedBalance(user, 'RUSD'), 100);
});

test('funding charges a long when the rate is positive and credits the insurance fund', () => {
  const symbol = pricedContract('FTGR', 10, { tickSize: 0.0001, minQuantity: 1 });
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 1000, leverage: 10 });
  const before = availableBalance(user, 'RUSD');

  const result = applyFunding(symbol, 0.001);
  assert.equal(result.rate, 0.001);
  assert.equal(result.positions, 1);
  assert.equal(result.indexPrice, 10);

  // 1,000 TGR at 10 is 10,000 notional; a long pays 10 at 0.1%.
  assert.ok(availableBalance(user, 'RUSD') < before - 9);
  const fund = db.prepare('SELECT balance FROM insurance_funds WHERE contract = ?').get(symbol);
  assert.ok(Number(fund.balance) > 9);

  // A rate beyond the cap is clamped to the cap.
  assert.equal(applyFunding(symbol, 5).rate, 0.01);
});

test('funding pays a short when the rate is positive', () => {
  const symbol = pricedContract('SETH', 3000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'sell', type: 'market', quantity: 1, leverage: 10 });
  const before = availableBalance(user, 'RUSD');

  applyFunding(symbol, 0.001);
  // 3,000 notional at 0.1% pays the short 3.
  assert.ok(availableBalance(user, 'RUSD') > before + 2);
});

test('a breached position is queued once and then liquidated at the mark', () => {
  const symbol = pricedContract('XSOL', 100);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 20, leverage: 20 });
  // 20 SOL at 100 is 2,000 notional; 20x locks 100 of margin. Drop the index
  // to 90, a 200 loss against 100 of margin, which breaches maintenance.
  setOraclePrice(symbol, 90);

  const scan = scanPositions();
  assert.equal(scan.queued.filter((entry) => entry.symbol === symbol).length, 1);
  assert.equal(scan.unpriced.length, 0);

  // A second scan does not enqueue the same position twice.
  assert.equal(scanPositions().queued.filter((entry) => entry.symbol === symbol).length, 0);

  const queued = db.prepare('SELECT status FROM liquidation_queue WHERE symbol = ?').get(symbol);
  assert.equal(queued.status, 'pending');

  const processed = processQueue();
  const handled = processed.processed.filter((entry) => entry.symbol === symbol);
  assert.equal(handled.length, 1);
  assert.ok(handled[0].insuranceDraw > 0);

  const position = db.prepare('SELECT status FROM futures_positions WHERE user_id = ?').get(user);
  assert.equal(position.status, 'liquidated');
  assert.equal(lockedBalance(user, 'RUSD'), 0);

  const entry = db.prepare('SELECT status FROM liquidation_queue WHERE symbol = ?').get(symbol);
  assert.equal(entry.status, 'executed');
});

test('a healthy position is not queued for liquidation', () => {
  const symbol = pricedContract('HBTC', 50000);
  const user = seedUser();
  credit(user, 'RUSD', 100000);

  placeFuturesOrder(user, { symbol, side: 'buy', type: 'market', quantity: 0.01, leverage: 10 });

  assert.equal(scanPositions().queued.filter((entry) => entry.symbol === symbol).length, 0);
  const row = db.prepare('SELECT status FROM futures_positions WHERE user_id = ?').get(user);
  assert.equal(row.status, 'open');
});
