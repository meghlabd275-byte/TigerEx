'use strict';
/**
 * Tests for TigerSwap perpetual conditional orders and reduce-only closes.
 *
 * The pure trigger rule is exercised directly, and the DB-backed cases run a
 * real SQLite database built from the production schema: an order is placed,
 * the mark is moved, the keeper's trigger pass runs, and the balances and rows
 * it wrote are asserted. Nothing is stubbed, so a stop that fires on the wrong
 * side or a reduce that mints margin fails the suite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-dex-conditional-')), 'dex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const { AmmError } = require('../../.test-build/amm.js');
const { DexError } = require('../../.test-build/pool-service.js');
const {
  evaluateConditional,
  reductionQuantity,
  validateConditionalParams,
} = require('../../.test-build/conditional.js');
const {
  openPosition,
  reducePosition,
  placeConditionalOrder,
  listConditionalOrders,
  cancelConditionalOrder,
  triggerConditionalOrders,
  fundPerpPool,
} = require('../../.test-build/perps-service.js');
const { runPerpCycle, runKeeperCycle } = require('../../.test-build/keeper.js');

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

let contractSeq = 0;

function listPerp(base, price, maintenanceRate = 0.005, settlement = 'RUSD') {
  contractSeq += 1;
  const symbol = `${base}${contractSeq}/RUSD`;
  db.prepare(
    `INSERT INTO futures_markets
       (market_id, symbol, base_asset, quote_asset, settlement_asset, contract_type, listing_type,
        contract_size, tick_size, min_quantity, max_quantity, max_leverage, maker_fee_bps, taker_fee_bps,
        funding_interval_hours, funding_rate_cap, maintenance_margin_rate, initial_margin_rate,
        liquidation_fee_rate, insurance_fund_share, status)
     VALUES (?, ?, ?, 'RUSD', ?, 'RUSD_M', 'perpetual', 1, 0.1, 0.001, 1000000, 100, 2, 5, 8, 0.01, ?, 0.008, 0.005, 0.1, 'active')`,
  ).run(generateId(), symbol, base, settlement, maintenanceRate);
  db.prepare('INSERT INTO market_data (id, symbol, price, volume_24h) VALUES (?, ?, ?, 0)').run(
    generateId(),
    symbol,
    price,
  );
  return symbol;
}

function setMark(symbol, price) {
  db.prepare('UPDATE market_data SET price = ? WHERE symbol = ?').run(price, symbol);
}

// ---------------------------------------------------------------------------
// Pure trigger rule
// ---------------------------------------------------------------------------

test('a long stop-loss fires only once the mark falls to the stop', () => {
  const base = { type: 'stop_loss', positionSide: 'long', stopPrice: 90 };
  assert.equal(evaluateConditional({ ...base, mark: 95 }).trigger, false);
  assert.equal(evaluateConditional({ ...base, mark: 90 }).trigger, true);
  assert.equal(evaluateConditional({ ...base, mark: 85 }).trigger, true);
});

test('a short stop-loss fires once the mark rises to the stop', () => {
  const base = { type: 'stop_loss', positionSide: 'short', stopPrice: 110 };
  assert.equal(evaluateConditional({ ...base, mark: 105 }).trigger, false);
  assert.equal(evaluateConditional({ ...base, mark: 110 }).trigger, true);
});

test('a take-profit is the mirror of a stop-loss', () => {
  assert.equal(evaluateConditional({ type: 'take_profit', positionSide: 'long', stopPrice: 110, mark: 105 }).trigger, false);
  assert.equal(evaluateConditional({ type: 'take_profit', positionSide: 'long', stopPrice: 110, mark: 110 }).trigger, true);
  assert.equal(evaluateConditional({ type: 'take_profit', positionSide: 'short', stopPrice: 90, mark: 90 }).trigger, true);
});

test('a trailing stop anchors the peak and fires on the retracement', () => {
  const first = evaluateConditional({ type: 'trailing_stop', positionSide: 'long', callbackRate: 0.1, mark: 120, anchor: 100 });
  assert.equal(first.trigger, false);
  assert.equal(first.anchor, 120, 'the peak follows the mark up');
  // The anchor only ever moves in the position's favour: a lower mark cannot
  // lower the peak and loosen the stop.
  const second = evaluateConditional({ type: 'trailing_stop', positionSide: 'long', callbackRate: 0.1, mark: 115, anchor: first.anchor });
  assert.equal(second.anchor, 120, 'the peak does not fall back');
  assert.equal(second.trigger, false, 'a 5% retracement is inside a 10% callback');
  const third = evaluateConditional({ type: 'trailing_stop', positionSide: 'long', callbackRate: 0.1, mark: 108, anchor: second.anchor });
  assert.equal(third.trigger, true, 'a 10% retracement from the peak fires');
});

test('a short trailing stop tracks the trough', () => {
  const first = evaluateConditional({ type: 'trailing_stop', positionSide: 'short', callbackRate: 0.1, mark: 80, anchor: 100 });
  assert.equal(first.anchor, 80);
  const second = evaluateConditional({ type: 'trailing_stop', positionSide: 'short', callbackRate: 0.1, mark: 88, anchor: first.anchor });
  assert.equal(second.anchor, 80, 'the trough does not rise back');
  assert.equal(second.trigger, true, 'a 10% bounce from the trough fires');
});

test('the trigger rule fails closed on a missing or non-positive price', () => {
  assert.throws(() => evaluateConditional({ type: 'stop_loss', positionSide: 'long', stopPrice: 90, mark: 0 }), AmmError);
  assert.throws(() => evaluateConditional({ type: 'stop_loss', positionSide: 'long', stopPrice: 90, mark: NaN }), AmmError);
  assert.throws(() => evaluateConditional({ type: 'stop_loss', positionSide: 'long', stopPrice: 0, mark: 100 }), AmmError);
  assert.throws(
    () => evaluateConditional({ type: 'trailing_stop', positionSide: 'long', callbackRate: 1.5, mark: 100 }),
    AmmError,
  );
});

test('the reduce quantity is capped at the open position and rejects non-positive input', () => {
  assert.equal(reductionQuantity(5, 3), 3, 'never reduces more than is open');
  assert.equal(reductionQuantity(2, 10), 2);
  assert.equal(reductionQuantity(0, 10), 0);
  assert.equal(reductionQuantity(-1, 10), 0);
  assert.equal(reductionQuantity(5, 0), 0);
});

test('parameter validation rejects a bad stop and a bad callback', () => {
  assert.throws(() => validateConditionalParams('stop_loss', { stopPrice: 0 }), AmmError);
  assert.throws(() => validateConditionalParams('take_profit', { stopPrice: -5 }), AmmError);
  assert.throws(() => validateConditionalParams('trailing_stop', { callbackRate: 0 }), AmmError);
  assert.throws(() => validateConditionalParams('trailing_stop', { callbackRate: 1 }), AmmError);
  assert.deepEqual(validateConditionalParams('stop_loss', { stopPrice: 90 }), { stopPrice: 90, callbackRate: null });
  assert.deepEqual(validateConditionalParams('trailing_stop', { callbackRate: 0.05 }), { stopPrice: null, callbackRate: 0.05 });
});

// ---------------------------------------------------------------------------
// DB-backed: placing, triggering, cancelling
// ---------------------------------------------------------------------------

test('a stop-loss fires, closes the position, and settles real funds', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('STPX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  assert.equal(lockedBalance(trader, 'RUSD'), opened.margin);

  const order = placeConditionalOrder({
    userId: trader,
    positionId: opened.positionId,
    type: 'stop_loss',
    quantity: 1,
    stopPrice: 49000,
  });
  assert.equal(order.status, 'pending');
  assert.equal(order.side, 'sell', 'a long is protected by a sell');
  assert.equal(listConditionalOrders(trader).length, 1);

  // Nothing fires while the mark is above the stop.
  setMark(symbol, 49500);
  assert.equal(triggerConditionalOrders().triggered.length, 0);
  assert.equal(lockedBalance(trader, 'RUSD'), opened.margin, 'the margin is still reserved');

  // A drop through the stop closes the position at the mark.
  setMark(symbol, 48000);
  const report = triggerConditionalOrders();
  assert.equal(report.triggered.length, 1);
  assert.equal(report.triggered[0].closed, true);

  const row = db.prepare('SELECT status FROM dex_perp_positions WHERE position_id = ?').get(opened.positionId);
  assert.equal(row.status, 'closed');
  assert.equal(lockedBalance(trader, 'RUSD'), 0, 'the margin reservation is released');
  const orderRow = db.prepare('SELECT status FROM dex_perp_conditional_orders WHERE order_id = ?').get(order.orderId);
  assert.equal(orderRow.status, 'triggered');

  // Opening balance less the open fee, the price loss and the close fee.
  const openFee = (1 * 50000 * 5) / 10_000;
  const closeFee = (1 * 48000 * 5) / 10_000;
  const priceLoss = 2000;
  assert.ok(
    Math.abs(availableBalance(trader, 'RUSD') - (100000 - openFee - priceLoss - closeFee)) < 1e-6,
    `available ${availableBalance(trader, 'RUSD')}`,
  );
});

test('a take-profit closes a profitable long and pays out of the funded pool', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('TPX', 50000);
  fundPerpPool('RUSD', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });

  placeConditionalOrder({ userId: trader, positionId: opened.positionId, type: 'take_profit', quantity: 1, stopPrice: 55000 });
  setMark(symbol, 55000);
  const report = triggerConditionalOrders();
  assert.equal(report.triggered.length, 1);

  const openFee = (1 * 50000 * 5) / 10_000;
  const closeFee = (1 * 55000 * 5) / 10_000;
  const priceGain = 5000;
  assert.ok(
    Math.abs(availableBalance(trader, 'RUSD') - (100000 - openFee + priceGain - closeFee)) < 1e-6,
    `available ${availableBalance(trader, 'RUSD')}`,
  );
});

test('a trailing stop follows the mark up, then fires on the retracement', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('TRLX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  const order = placeConditionalOrder({
    userId: trader,
    positionId: opened.positionId,
    type: 'trailing_stop',
    quantity: 1,
    callbackRate: 0.05,
  });

  // The mark rises: the anchor follows and nothing fires.
  setMark(symbol, 60000);
  assert.equal(triggerConditionalOrders().triggered.length, 0);
  const anchored = db.prepare('SELECT anchor FROM dex_perp_conditional_orders WHERE order_id = ?').get(order.orderId);
  assert.equal(anchored.anchor, 60000, 'the peak is persisted between cycles');

  // A 5% retracement from the 60000 peak fires.
  setMark(symbol, 56900);
  const report = triggerConditionalOrders();
  assert.equal(report.triggered.length, 1);
  assert.equal(report.triggered[0].closed, true);
});

test('a stop parked on the wrong side of the mark is refused', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('SIDEX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  assert.throws(
    () => placeConditionalOrder({ userId: trader, positionId: opened.positionId, type: 'stop_loss', quantity: 1, stopPrice: 51000 }),
    DexError,
  );
  assert.throws(
    () => placeConditionalOrder({ userId: trader, positionId: opened.positionId, type: 'take_profit', quantity: 1, stopPrice: 49000 }),
    DexError,
  );
  assert.equal(listConditionalOrders(trader).length, 0, 'a refused order is not stored');
});

test('a conditional order cannot exceed the position it protects', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('QTYX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  assert.throws(
    () => placeConditionalOrder({ userId: trader, positionId: opened.positionId, type: 'stop_loss', quantity: 2, stopPrice: 49000 }),
    DexError,
  );
});

test('a conditional order is cancelled by its owner only', () => {
  const trader = seedUser();
  const other = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('OWNX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  const order = placeConditionalOrder({ userId: trader, positionId: opened.positionId, type: 'stop_loss', quantity: 1, stopPrice: 49000 });

  assert.throws(() => cancelConditionalOrder(other, order.orderId), DexError);
  const cancelled = cancelConditionalOrder(trader, order.orderId);
  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => cancelConditionalOrder(trader, order.orderId), DexError, 'a terminal order cannot be cancelled again');
});

test('a position closed by a full reduce cancels the orders that protected it', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('CLRX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  const order = placeConditionalOrder({ userId: trader, positionId: opened.positionId, type: 'stop_loss', quantity: 1, stopPrice: 49000 });

  reducePosition(trader, opened.positionId, 1);
  const orderRow = db.prepare('SELECT status FROM dex_perp_conditional_orders WHERE order_id = ?').get(order.orderId);
  assert.equal(orderRow.status, 'cancelled');
});

test('a conditional order whose position has gone is cancelled, not fired', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('GONEX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  const order = placeConditionalOrder({ userId: trader, positionId: opened.positionId, type: 'stop_loss', quantity: 1, stopPrice: 49000 });

  // Delete the position out from under the order to model a position that has
  // gone without the cancel hook running.
  db.prepare("UPDATE dex_perp_positions SET status = 'closed' WHERE position_id = ?").run(opened.positionId);
  setMark(symbol, 48000);
  const report = triggerConditionalOrders();
  assert.equal(report.triggered.length, 0, 'nothing fires against a position that is gone');
  const orderRow = db.prepare('SELECT status FROM dex_perp_conditional_orders WHERE order_id = ?').get(order.orderId);
  assert.equal(orderRow.status, 'cancelled');
});

// ---------------------------------------------------------------------------
// DB-backed: reduce-only
// ---------------------------------------------------------------------------

test('a partial reduce returns pro-rata margin and keeps the position open', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('REDX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 10, leverage: 10 });
  assert.equal(opened.margin, 50000);
  assert.equal(lockedBalance(trader, 'RUSD'), 50000);

  const reduced = reducePosition(trader, opened.positionId, 4);
  assert.equal(reduced.closed, false);
  assert.equal(reduced.remainingSize, 6);
  assert.equal(reduced.closedSize, 4);
  // Four of ten closed returns two fifths of the margin.
  assert.ok(Math.abs(lockedBalance(trader, 'RUSD') - 30000) < 1e-6, `locked ${lockedBalance(trader, 'RUSD')}`);
  const row = db.prepare('SELECT size, collateral, status FROM dex_perp_positions WHERE position_id = ?').get(opened.positionId);
  assert.equal(row.status, 'open');
  assert.ok(Math.abs(row.size - 6) < 1e-9);
  assert.ok(Math.abs(row.collateral - 30000) < 1e-6);
});

test('a reduce that would leave nothing closes the position', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('RED2X', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  const reduced = reducePosition(trader, opened.positionId, 1);
  assert.equal(reduced.closed, true);
  assert.equal(reduced.remainingSize, 0);
  assert.equal(lockedBalance(trader, 'RUSD'), 0);
});

test('a reduce larger than the position is capped at the position', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('RED3X', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  const reduced = reducePosition(trader, opened.positionId, 5);
  assert.equal(reduced.closedSize, 1);
  assert.equal(reduced.closed, true);
  assert.equal(lockedBalance(trader, 'RUSD'), 0);
});

// ---------------------------------------------------------------------------
// DB-backed: keeper wiring
// ---------------------------------------------------------------------------

test('the keeper perp cycle fires conditional orders and reports the count', () => {
  const trader = seedUser();
  credit(trader, 'RUSD', 100000);
  const symbol = listPerp('KEEPX', 50000);
  const opened = openPosition({ userId: trader, symbol, side: 'long', size: 1, leverage: 10 });
  placeConditionalOrder({ userId: trader, positionId: opened.positionId, type: 'stop_loss', quantity: 1, stopPrice: 49000 });
  setMark(symbol, 48000);

  const cycle = runPerpCycle();
  assert.equal(cycle.conditionalTriggered, 1);

  const full = runKeeperCycle();
  assert.equal(typeof full.conditionalOrdersTriggered, 'number');
});
