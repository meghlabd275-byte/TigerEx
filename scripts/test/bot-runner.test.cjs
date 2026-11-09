'use strict';
/**
 * Integration tests for the CEX trading-bot runner.
 *
 * A bot is created through the same validator the API uses, started, and then
 * ticked against a real SQLite book. The assertions read the real `orders` rows
 * and balances afterwards, so a bot that decided to trade but never settled
 * would fail here. Nothing is stubbed: the runner places orders through
 * `placeSpotOrder`, exactly as a user would.
 */
const test = require('node:test');
const { beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-botrun-')), 'botrun.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const { createBot, setBotStatus, listUserBots } = require('../../.test-build/instances.js');
const { runBotTick, runDueBots } = require('../../.test-build/runner.js');
const { placeSpotOrder } = require('../../.test-build/spot-engine.js');

const db = getDb();

// A scheduler sweeps every running bot, so a bot left running by one test would
// be ticked by another. Each test starts from a clean set of stopped bots.
beforeEach(() => {
  db.prepare("UPDATE trading_bots SET status = 'stopped'").run();
});

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

let pairSeq = 0;
function listPair(base) {
  pairSeq += 1;
  const pairId = `${base}RUSD-${pairSeq}`;
  const symbol = `${base}/RUSD`;
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, 'RUSD', ?, 'active', 0.01, 0.0001, 100000, 1, 0.001, 0.001)`,
  ).run(pairId, base, symbol);
  return { pairId, symbol };
}

/** Record a settled trade so the venue has an observed price. */
function observedTrade(symbol, price) {
  db.prepare(
    `INSERT INTO spot_trades (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id, side, price, quantity, quote_quantity)
     VALUES (?, ?, ?, ?, ?, ?, 'buy', ?, 1, ?)`,
  ).run(generateId(), symbol, generateId(), generateId(), generateId(), generateId(), price, price);
}

function botRow(botId) {
  return db
    .prepare('SELECT bot_id, user_id, strategy, symbol, params, status, state, last_run_ns FROM trading_bots WHERE bot_id = ?')
    .get(botId);
}

function botOrders(botId) {
  return db.prepare('SELECT side, type, price, quantity, status FROM orders WHERE bot_id = ?').all(botId);
}

test('a grid bot quotes a bid below and an ask above the observed price', () => {
  const user = seedUser();
  const { symbol } = listPair('GRID');
  credit(user, 'RUSD', 100000);
  credit(user, 'GRID', 100);
  observedTrade(symbol, 150);

  const bot = createBot(user, {
    strategy: 'spot_grid',
    symbol,
    params: { lowerPrice: 100, upperPrice: 200, grids: 4, orderSize: 1 },
  });
  setBotStatus(user, bot.id, 'running');

  const result = runBotTick(botRow(bot.id));
  assert.equal(result.action, 'placed');
  assert.equal(result.orders.length, 2);

  const orders = botOrders(bot.id);
  assert.equal(orders.length, 2);
  const buy = orders.find((o) => o.side === 'buy');
  const sell = orders.find((o) => o.side === 'sell');
  // Nearest ladder level below 150 is 125; nearest above is 175.
  assert.equal(buy.price, 125);
  assert.equal(sell.price, 175);
  // A buy reserves quote, a sell reserves base.
  assert.equal(lockedBalance(user, 'RUSD'), 125);
  assert.equal(lockedBalance(user, 'GRID'), 1);
});

test('a second tick does not stack duplicate grid orders', () => {
  const user = seedUser();
  const { symbol } = listPair('GRID2');
  credit(user, 'RUSD', 100000);
  credit(user, 'GRID2', 100);
  observedTrade(symbol, 150);

  const bot = createBot(user, {
    strategy: 'spot_grid',
    symbol,
    params: { lowerPrice: 100, upperPrice: 200, grids: 4, orderSize: 1 },
  });
  setBotStatus(user, bot.id, 'running');

  assert.equal(runBotTick(botRow(bot.id)).action, 'placed');
  const second = runBotTick(botRow(bot.id));
  assert.equal(second.action, 'skipped');
  assert.equal(botOrders(bot.id).length, 2);
});

test('a grid bot with no funds to reserve is skipped, not failed', () => {
  const user = seedUser();
  const { symbol } = listPair('GRID3');
  observedTrade(symbol, 150);

  const bot = createBot(user, {
    strategy: 'spot_grid',
    symbol,
    params: { lowerPrice: 100, upperPrice: 200, grids: 4, orderSize: 1 },
  });
  setBotStatus(user, bot.id, 'running');

  const result = runBotTick(botRow(bot.id));
  assert.equal(result.action, 'skipped');
  assert.match(result.reason, /refused/);
  assert.equal(botOrders(bot.id).length, 0);
});

test('a TWAP bot executes one slice per interval and advances its state', () => {
  const user = seedUser();
  const { symbol } = listPair('TWAP');
  credit(user, 'RUSD', 100000);
  observedTrade(symbol, 100);
  // Liquidity for the market buys to take, placed through the real engine so
  // the maker's base is actually reserved.
  const maker = seedUser();
  credit(maker, 'TWAP', 100);
  placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 100, quantity: 50 });

  const bot = createBot(user, {
    strategy: 'twap',
    symbol,
    params: { totalQuantity: 9, slices: 3, intervalNs: 1_000_000_000, side: 'buy' },
  });
  setBotStatus(user, bot.id, 'running');

  const first = runBotTick(botRow(bot.id), 1_000_000_000);
  assert.equal(first.action, 'placed');
  assert.equal(first.orders.length, 1);
  assert.equal(first.orders[0].quantity, 3);

  // Before the interval elapses the tick is inert.
  const tooSoon = runBotTick(botRow(bot.id), 1_500_000_000);
  assert.equal(tooSoon.action, 'skipped');
  assert.match(tooSoon.reason, /interval/);

  // After it elapses the next slice runs, and the step index is persisted.
  const second = runBotTick(botRow(bot.id), 3_000_000_000);
  assert.equal(second.action, 'placed');
  assert.equal(second.orders[0].quantity, 3);
  assert.equal(JSON.parse(botRow(bot.id).state).sliceIndex, 2);

  const third = runBotTick(botRow(bot.id), 5_000_000_000);
  assert.equal(third.action, 'placed');

  // All slices consumed: the bot stops placing.
  const fourth = runBotTick(botRow(bot.id), 7_000_000_000);
  assert.equal(fourth.action, 'skipped');
  assert.match(fourth.reason, /slices/);
});

test('runDueBots only ticks running bots', () => {
  const user = seedUser();
  const { symbol } = listPair('DUE');
  credit(user, 'RUSD', 100000);
  credit(user, 'DUE', 100);
  observedTrade(symbol, 150);

  const running = createBot(user, {
    strategy: 'spot_grid',
    symbol,
    params: { lowerPrice: 100, upperPrice: 200, grids: 4, orderSize: 1 },
  });
  setBotStatus(user, running.id, 'running');
  const stopped = createBot(user, {
    strategy: 'spot_grid',
    symbol,
    params: { lowerPrice: 100, upperPrice: 200, grids: 4, orderSize: 1 },
  });

  const results = runDueBots();
  const ids = results.map((r) => r.botId);
  assert.ok(ids.includes(running.id));
  assert.ok(!ids.includes(stopped.id));
  assert.equal(botOrders(stopped.id).length, 0);
});

test('a paused venue stops every bot from trading', () => {
  const user = seedUser();
  const { symbol } = listPair('PAUSE');
  credit(user, 'RUSD', 100000);
  credit(user, 'PAUSE', 100);
  observedTrade(symbol, 150);

  const bot = createBot(user, {
    strategy: 'spot_grid',
    symbol,
    params: { lowerPrice: 100, upperPrice: 200, grids: 4, orderSize: 1 },
  });
  setBotStatus(user, bot.id, 'running');

  db.prepare(
    `INSERT INTO exchange_controls (scope, paused, reason, updated_at)
     VALUES ('spot', 1, 'maintenance', datetime('now'))
     ON CONFLICT(scope) DO UPDATE SET paused = 1, reason = 'maintenance'`,
  ).run();

  const result = runBotTick(botRow(bot.id));
  assert.equal(result.action, 'skipped');
  assert.match(result.reason, /paused/);
  assert.equal(botOrders(bot.id).length, 0);

  // Restore so the venue is open for any later test.
  db.prepare("UPDATE exchange_controls SET paused = 0, reason = NULL WHERE scope = 'spot'").run();
});

test('a bot realized PnL reflects its real fills, not zero', () => {
  const user = seedUser();
  const { symbol } = listPair('PNL');
  credit(user, 'RUSD', 100000);
  observedTrade(symbol, 100);
  const maker = seedUser();
  credit(maker, 'PNL', 100);
  placeSpotOrder(maker, { symbol, side: 'sell', type: 'limit', price: 100, quantity: 50 });

  const bot = createBot(user, {
    strategy: 'twap',
    symbol,
    params: { totalQuantity: 2, slices: 2, intervalNs: 1, side: 'buy' },
  });
  setBotStatus(user, bot.id, 'running');

  assert.equal(runBotTick(botRow(bot.id)).action, 'placed');
  const pnl = db.prepare('SELECT realized_pnl FROM trading_bots WHERE bot_id = ?').get(bot.id).realized_pnl;
  // The bot bought 1 unit at 100 and paid a taker fee, so its realized quote
  // flow is the buy cost plus the fee, i.e. negative — not the default zero.
  assert.ok(pnl < 0, `expected a negative realized PnL, got ${pnl}`);
  assert.ok(Math.abs(pnl + 100) < 1, `expected about -100 of cost, got ${pnl}`);
});

test('a created bot is listed for its owner and starts stopped', () => {
  const user = seedUser();
  const { symbol } = listPair('LIST');
  const bot = createBot(user, {
    strategy: 'spot_grid',
    symbol,
    params: { lowerPrice: 100, upperPrice: 200, grids: 4, orderSize: 1 },
  });
  assert.equal(bot.status, 'stopped');
  assert.equal(listUserBots(user).length, 1);
  // A stopped bot is never ticked by the sweep.
  assert.equal(runDueBots().length, 0);
});
