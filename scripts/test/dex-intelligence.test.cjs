'use strict';
/**
 * Tests for TigerSwap's trading intelligence.
 *
 * The leaderboard, the whale feed and the smart-money signal all read the
 * venue's own settled rows, so a ranking must be built from real swaps and
 * closed positions, volume must be valued in the venue's own price, and an
 * asset the venue cannot price must be left out rather than valued at zero.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-dex-intel-')), 'dex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId } = require('../../.test-build/index.js');
const { traderLeaderboard, whaleAlerts, smartMoneySignals } = require('../../.test-build/intelligence.js');

const db = getDb();

function seedPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (symbol, price, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, updated_at = datetime('now')`,
  ).run(symbol, price);
}

function seedSwap(userId, tokenIn, amountIn, tokenOut, amountOut, fee = 0) {
  db.prepare(
    `INSERT INTO dex_swaps (swap_id, pool_id, user_id, token_in, token_out, amount_in, amount_out, fee)
     VALUES (?, 'pool-1', ?, ?, ?, ?, ?, ?)`,
  ).run(generateId(), userId, tokenIn, tokenOut, amountIn, amountOut, fee);
}

function seedClosedPerp(userId, realizedPnl) {
  db.prepare(
    `INSERT INTO dex_perp_positions
       (position_id, market, user_id, side, collateral_asset, collateral, size, entry_price, leverage, liquidation_price, realized_pnl, status)
     VALUES (?, 'BTC/RUSD', ?, 'long', 'RUSD', 1000, 1, 50000, 2, 40000, ?, 'closed')`,
  ).run(generateId(), userId, realizedPnl);
}

test('the leaderboard ranks by realised profit and values volume in the venue price', () => {
  seedPrice('ETH/RUSD', 2000);
  const winner = generateId();
  const runnerUp = generateId();
  seedSwap(winner, 'RUSD', 3000, 'ETH', 1.5, 9);
  seedClosedPerp(winner, 500);
  seedSwap(runnerUp, 'RUSD', 1000, 'ETH', 0.5, 3);
  seedClosedPerp(runnerUp, -100);

  const board = traderLeaderboard(10);
  assert.equal(board.fullyPriced, true);
  const first = board.traders.find((t) => t.userId === winner);
  const second = board.traders.find((t) => t.userId === runnerUp);
  assert.equal(first.volumeUsd, 3000);
  assert.equal(first.realizedPnlUsd, 500);
  assert.equal(first.feesUsd, 9);
  assert.equal(second.realizedPnlUsd, -100);
  assert.ok(
    board.traders.findIndex((t) => t.userId === winner) < board.traders.findIndex((t) => t.userId === runnerUp),
    'the more profitable trader must rank first',
  );
});

test('the leaderboard refuses an out-of-range limit and flags an unpriced asset', () => {
  assert.throws(() => traderLeaderboard(0), /limit/);
  assert.throws(() => traderLeaderboard(10_000), /limit/);

  const userId = generateId();
  // ZZZ has no price anywhere, so its volume cannot be counted.
  seedSwap(userId, 'ZZZ', 5, 'RUSD', 5, 0);
  const board = traderLeaderboard(10);
  assert.equal(board.fullyPriced, false, 'an unpriceable input must be reported, not silently valued');
});

test('the whale feed reports the leg that carried the value', () => {
  seedPrice('ETH/RUSD', 2000);
  const buyer = generateId();
  const seller = generateId();
  // A buy: 50,000 RUSD in, 25 ETH out, both sides worth 50,000.
  seedSwap(buyer, 'RUSD', 50_000, 'ETH', 25);
  // A sell: 10 ETH in (20,000) for 19,000 RUSD out; the input carries the value.
  seedSwap(seller, 'ETH', 10, 'RUSD', 19_000);

  const alerts = whaleAlerts(10_000, 50);
  const buy = alerts.find((a) => a.userId === buyer);
  const sell = alerts.find((a) => a.userId === seller);
  assert.equal(buy.side, 'buy');
  assert.equal(buy.asset, 'ETH');
  assert.equal(buy.valueUsd, 50_000);
  assert.equal(sell.side, 'sell');
  assert.equal(sell.asset, 'ETH');
  assert.equal(sell.valueUsd, 20_000);
});

test('the whale feed respects the threshold and rejects a bad one', () => {
  seedPrice('ETH/RUSD', 2000);
  const small = generateId();
  seedSwap(small, 'RUSD', 100, 'ETH', 0.05);
  assert.equal(whaleAlerts(10_000, 50).some((a) => a.userId === small), false, 'a small swap is not a whale');
  assert.throws(() => whaleAlerts(0), /threshold/);
});

test('the smart-money signal separates accumulation from distribution', () => {
  // A dedicated asset keeps the signal isolated from swaps other tests seeded.
  seedPrice('SOL/RUSD', 100);
  const a = generateId();
  const b = generateId();
  const c = generateId();
  // Two buyers take 5,000 of SOL, one seller supplies 500 back.
  seedSwap(a, 'RUSD', 4000, 'SOL', 40);
  seedSwap(b, 'RUSD', 1000, 'SOL', 10);
  seedSwap(c, 'SOL', 5, 'RUSD', 500);

  const signals = smartMoneySignals(1, 3);
  const sol = signals.find((s) => s.asset === 'SOL');
  assert.ok(sol, 'SOL must appear with three trades');
  assert.equal(sol.direction, 'accumulation');
  assert.equal(sol.netUsd, 4500);
  assert.ok(Math.abs(sol.strength - 4500 / 5500) < 1e-9, 'strength is net flow over gross flow');
  assert.ok(sol.strength >= -1 && sol.strength <= 1, 'strength is bounded');
});

test('the smart-money signal skips an asset with too few trades', () => {
  seedPrice('TGR/RUSD', 1);
  const solo = generateId();
  seedSwap(solo, 'RUSD', 500, 'TGR', 500);
  const signals = smartMoneySignals(1, 3);
  assert.equal(signals.some((s) => s.asset === 'TGR'), false, 'one trader is not a signal');
  assert.throws(() => smartMoneySignals(0), /windowDays/);
  assert.throws(() => smartMoneySignals(1, 0), /minTrades/);
});
