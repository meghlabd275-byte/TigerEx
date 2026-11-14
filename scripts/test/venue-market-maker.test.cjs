'use strict';
/**
 * Integration tests for the self-hosted venue market maker.
 *
 * The desk is exercised against a real SQLite book: it is configured, funded
 * from a real treasury account, and ticked. The assertions read the real
 * `orders` rows and balances afterwards, so a desk that decided to quote but
 * never settled, or that quoted inventory the venue does not hold, would fail
 * here. Nothing is stubbed: quotes go through `placeSpotOrder`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-mm-')), 'mm.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const { orderBookDepth } = require('../../.test-build/market-view.js');
const { placeSpotOrder } = require('../../.test-build/spot-engine.js');
const {
  runMarketMakerForSymbol,
  runMarketMakerCycle,
  setMarketMakerConfig,
  fundMarketMaker,
  creditTreasuryInventory,
  deskInventory,
  marketMakerStatus,
} = require('../../.test-build/venue-market-maker.js');

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
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, currency, available);
}

let pairSeq = 0;
/**
 * A market with its own base and quote currencies.
 *
 * The desk is a single account shared by every test, so each test uses a
 * distinct quote currency; otherwise a balance funded by one test would leak
 * into the next and a "cannot fund" case would see someone else's money.
 */
function listPair(base) {
  pairSeq += 1;
  const quote = `${base}Q`;
  const pairId = `${base}${quote}-${pairSeq}`;
  const symbol = `${base}/${quote}`;
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, ?, ?, 'active', 0.01, 0.0001, 100000, 1, 0.001, 0.001)`,
  ).run(pairId, base, quote, symbol);
  return { pairId, symbol, base, quote };
}

/** Record a settled trade so the venue has an observed price. */
function setLastPrice(symbol, price) {
  db.prepare(
    `INSERT INTO spot_trades
       (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id, side, price, quantity, quote_quantity, maker_fee, taker_fee)
     VALUES (?, ?, ?, ?, ?, ?, 'buy', ?, 1, ?, 0, 0)`,
  ).run(generateId(), symbol, generateId(), generateId(), generateId(), generateId(), price, price);
}

function configure(symbol, overrides = {}) {
  return setMarketMakerConfig({
    symbol,
    enabled: true,
    spread: 0.02,
    quoteQuantity: 5,
    maxInventory: 1000,
    targetInventory: 0,
    maxDeviation: 0.1,
    ...overrides,
  });
}

test('the desk quotes a post-only two-sided market once funded', () => {
  const { symbol, base, quote } = listPair('MM1');
  setLastPrice(symbol, 100);
  configure(symbol);
  creditTreasuryInventory(base, 1000);
  creditTreasuryInventory(quote, 100000);
  fundMarketMaker(symbol, 100, 5000);

  const tick = runMarketMakerForSymbol(symbol);
  assert.equal(tick.action, 'quoted');

  const depth = orderBookDepth(symbol, 5);
  assert.ok(depth.bids.length >= 1, 'a bid is resting');
  assert.ok(depth.asks.length >= 1, 'an ask is resting');
  // The desk quotes around the 100 mid, on valid ticks, and never crosses.
  assert.ok(depth.bids[0].price < 100, 'the bid is below the mid');
  assert.ok(depth.asks[0].price > 100, 'the ask is above the mid');
  assert.ok(depth.bids[0].price < depth.asks[0].price, 'post-only quotes never cross');
  const onTick = (price) => Math.abs(price / 0.01 - Math.round(price / 0.01)) < 1e-6;
  assert.ok(onTick(depth.bids[0].price), 'the bid rests on a valid tick');
  assert.ok(onTick(depth.asks[0].price), 'the ask rests on a valid tick');
});

test('a second tick at the same price is idempotent, not a duplicate', () => {
  const { symbol, base, quote } = listPair('MM2');
  setLastPrice(symbol, 100);
  configure(symbol);
  creditTreasuryInventory(base, 1000);
  creditTreasuryInventory(quote, 100000);
  fundMarketMaker(symbol, 100, 5000);

  runMarketMakerForSymbol(symbol);
  const before = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE p.symbol = ? AND o.status IN ('open', 'partial')`,
    )
    .get(symbol);
  const tick = runMarketMakerForSymbol(symbol);
  const after = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE p.symbol = ? AND o.status IN ('open', 'partial')`,
    )
    .get(symbol);
  assert.equal(tick.action, 'skipped');
  assert.equal(before.n, after.n, 'no duplicate quotes were stacked');
  assert.equal(after.n, 2);
});

test('the desk replaces its quotes when the market moves', () => {
  const { symbol, base, quote } = listPair('MM3');
  setLastPrice(symbol, 100);
  configure(symbol);
  creditTreasuryInventory(base, 1000);
  creditTreasuryInventory(quote, 100000);
  fundMarketMaker(symbol, 100, 5000);

  runMarketMakerForSymbol(symbol);
  // The book is emptied and the market is repriced to 200.
  db.prepare(
    `UPDATE orders SET status = 'cancelled'
      WHERE pair_id = (SELECT pair_id FROM trading_pairs WHERE symbol = ?) AND status IN ('open', 'partial')`,
  ).run(symbol);
  db.prepare('DELETE FROM spot_trades').run();
  setLastPrice(symbol, 200);

  const tick = runMarketMakerForSymbol(symbol);
  assert.equal(tick.action, 'quoted');
  const depth = orderBookDepth(symbol, 5);
  assert.ok(depth.bids[0].price > 190 && depth.bids[0].price < 200, 'the bid follows the new price');
  assert.ok(depth.asks[0].price > 200 && depth.asks[0].price < 210, 'the ask follows the new price');
});

test('the desk withdraws its quotes when the market strays from target', () => {
  const { symbol, base, quote } = listPair('MM4');
  setLastPrice(symbol, 100);
  configure(symbol, { targetPrice: 100, maxDeviation: 0.1 });
  creditTreasuryInventory(base, 1000);
  creditTreasuryInventory(quote, 100000);
  fundMarketMaker(symbol, 100, 5000);

  runMarketMakerForSymbol(symbol);
  // The market jumps 50% past the target band.
  db.prepare(
    `UPDATE orders SET status = 'cancelled'
      WHERE pair_id = (SELECT pair_id FROM trading_pairs WHERE symbol = ?) AND status IN ('open', 'partial')`,
  ).run(symbol);
  db.prepare('DELETE FROM spot_trades').run();
  setLastPrice(symbol, 150);

  const tick = runMarketMakerForSymbol(symbol);
  assert.equal(tick.action, 'skipped');
  const depth = orderBookDepth(symbol, 5);
  assert.equal(depth.bids.length, 0);
  assert.equal(depth.asks.length, 0);
});

test('a taker lifts the desk ask and settles against the desk inventory', () => {
  const { symbol, base, quote } = listPair('MM5');
  setLastPrice(symbol, 100);
  configure(symbol, { quoteQuantity: 5 });
  creditTreasuryInventory(base, 1000);
  creditTreasuryInventory(quote, 100000);
  fundMarketMaker(symbol, 100, 5000);
  runMarketMakerForSymbol(symbol);

  const inventoryBefore = deskInventory(symbol);
  const ask = orderBookDepth(symbol, 5).asks[0].price;
  const taker = seedUser();
  credit(taker, quote, 10000);
  const fill = placeSpotOrder(taker, { symbol, side: 'buy', type: 'limit', price: ask, quantity: 5 });
  assert.equal(fill.filledQuantity, 5);

  // The desk sold 5 base; the reservation is released as the trade settles.
  assert.equal(deskInventory(symbol), inventoryBefore - 5);
  const status = marketMakerStatus().find((s) => s.symbol === symbol);
  assert.ok(status.quoteBalance > 5000, 'the desk holds the proceeds');
});

test('the desk refuses to quote a buy it cannot fund', () => {
  const { symbol, base, quote } = listPair('MM6');
  setLastPrice(symbol, 100);
  configure(symbol, { quoteQuantity: 5 });
  creditTreasuryInventory(base, 1000);
  creditTreasuryInventory(quote, 100000);
  // Fund base inventory but no quote currency: the bid cannot be funded.
  fundMarketMaker(symbol, 100, 0);
  const tick = runMarketMakerForSymbol(symbol);
  const depth = orderBookDepth(symbol, 5);
  assert.equal(depth.bids.length, 0, 'no unfunded bid is quoted');
  assert.equal(depth.asks.length, 1, 'the funded ask is still quoted');
  assert.equal(tick.action, 'quoted');
});

test('the desk quotes nothing without an observable price', () => {
  const { symbol, base, quote } = listPair('MM7');
  configure(symbol);
  creditTreasuryInventory(base, 1000);
  creditTreasuryInventory(quote, 100000);
  fundMarketMaker(symbol, 100, 5000);
  const tick = runMarketMakerForSymbol(symbol);
  assert.equal(tick.action, 'skipped');
  assert.match(tick.reason, /no observable price/);
});

test('disabling a market withdraws the desk quotes', () => {
  const { symbol, base, quote } = listPair('MM8');
  setLastPrice(symbol, 100);
  configure(symbol);
  creditTreasuryInventory(base, 1000);
  creditTreasuryInventory(quote, 100000);
  fundMarketMaker(symbol, 100, 5000);
  runMarketMakerForSymbol(symbol);
  assert.equal(orderBookDepth(symbol, 5).bids.length, 1);

  configure(symbol, { enabled: false });
  assert.equal(orderBookDepth(symbol, 5).bids.length, 0);
  assert.equal(orderBookDepth(symbol, 5).asks.length, 0);
});

test('a cycle quotes every enabled market and reports disabled ones', () => {
  const a = listPair('MM9A');
  const b = listPair('MM9B');
  setLastPrice(a.symbol, 100);
  setLastPrice(b.symbol, 50);
  configure(a.symbol);
  configure(b.symbol);
  creditTreasuryInventory(a.base, 1000);
  creditTreasuryInventory(b.base, 1000);
  creditTreasuryInventory(a.quote, 100000);
  creditTreasuryInventory(b.quote, 100000);
  fundMarketMaker(a.symbol, 100, 5000);
  fundMarketMaker(b.symbol, 100, 5000);

  const ticks = runMarketMakerCycle();
  assert.ok(ticks.length >= 2);
  for (const tick of ticks) {
    if (tick.symbol === a.symbol || tick.symbol === b.symbol) assert.equal(tick.action, 'quoted');
  }
});
