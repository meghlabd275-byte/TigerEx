'use strict';
/**
 * Account statements and tax reports, against a real database.
 *
 * A statement lists the period's movements and totals per asset; a tax report
 * realises P&L with the average-cost method and sums fees. CSV output is quoted
 * correctly. An empty period yields an empty report, never a fabricated one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-statements-')), 'statements.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const {
  buildStatement,
  buildTaxReport,
  parsePeriod,
  statementToCsv,
  taxReportToCsv,
  csvField,
  StatementError,
} = require('../../.test-build/statements.js');

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

function seedTransaction(userId, type, currency, amount, fee, whenIso) {
  db.prepare(
    `INSERT INTO transactions (transaction_id, user_id, type, currency, amount, fee, status, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
  ).run(generateId(), userId, type, currency, amount, fee, `${type} memo`, whenIso);
}

function seedTrade(symbol, makerUserId, takerUserId, side, price, quantity, makerFee, takerFee, whenIso) {
  db.prepare(
    `INSERT INTO spot_trades
       (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id, side, price, quantity, quote_quantity, maker_fee, taker_fee, created_at)
     VALUES (?, ?, 'mo', 'to', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(generateId(), symbol, makerUserId, takerUserId, side, price, quantity, price * quantity, makerFee, takerFee, whenIso);
}

const PERIOD = { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T23:59:59.000Z' };

test('parsePeriod rejects an inverted range and defaults to 30 days', () => {
  assert.throws(() => parsePeriod('2026-05-01', '2026-04-01'), (error) => error instanceof StatementError && error.code === 'INVALID_PERIOD');
  const period = parsePeriod(null, null, new Date('2026-06-15T00:00:00Z'));
  const spanDays = (new Date(period.to).getTime() - new Date(period.from).getTime()) / 86400000;
  assert.ok(Math.abs(spanDays - 30) < 0.01);
});

test('a statement lists the period movements and totals per asset', () => {
  const userId = seedUser();
  seedTransaction(userId, 'deposit', 'USDT', 1000, 0, '2026-03-01 10:00:00');
  seedTransaction(userId, 'withdrawal', 'USDT', 200, 1, '2026-03-02 10:00:00');
  seedTransaction(userId, 'deposit', 'BTC', 0.5, 0, '2026-03-03 10:00:00');

  const statement = buildStatement(userId, PERIOD);
  assert.equal(statement.lines.length, 3);
  const usdt = statement.totalsByAsset.find((t) => t.asset === 'USDT');
  assert.equal(usdt.amount, 1200);
  assert.equal(usdt.fee, 1);
  const btc = statement.totalsByAsset.find((t) => t.asset === 'BTC');
  assert.equal(btc.amount, 0.5);
});

test('a movement outside the period is excluded', () => {
  const userId = seedUser();
  seedTransaction(userId, 'deposit', 'USDT', 500, 0, '2025-12-31 23:00:00');
  const statement = buildStatement(userId, PERIOD);
  assert.equal(statement.lines.length, 0);
});

test('a tax report realises P&L with average cost and sums fees', () => {
  const userId = seedUser();
  const counterparty = seedUser();
  // `side` is the taker's side. The user buys 1 BTC at 100 as taker, then sells
  // 1 BTC at 150 as maker (the taker there is the buyer): realised 50.
  seedTrade('BTC/USDT', counterparty, userId, 'buy', 100, 1, 0.1, 0.2, '2026-02-01 10:00:00');
  seedTrade('BTC/USDT', userId, counterparty, 'buy', 150, 1, 0.15, 0.3, '2026-02-02 10:00:00');

  const report = buildTaxReport(userId, PERIOD);
  const btc = report.lots.find((l) => l.asset === 'BTC');
  assert.ok(btc);
  assert.equal(btc.realizedPnl, 50);
  // The user paid the taker fee on the first fill and the maker fee on the second.
  assert.equal(btc.fees, 0.35);
  assert.equal(report.totalRealizedPnl, 50);
  assert.equal(report.totalFees, 0.35);
});

test('an empty period yields an empty report, not a fabricated one', () => {
  const userId = seedUser();
  const report = buildTaxReport(userId, PERIOD);
  assert.equal(report.lots.length, 0);
  assert.equal(report.totalRealizedPnl, 0);
  assert.equal(report.totalFees, 0);
});

test('CSV output quotes fields containing commas, quotes and newlines', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line\nbreak'), '"line\nbreak"');
  assert.equal(csvField(null), '');
});

test('statement and tax CSV have the expected header and rows', () => {
  const userId = seedUser();
  seedTransaction(userId, 'deposit', 'USDT', 100, 0, '2026-03-01 10:00:00');
  const statement = buildStatement(userId, PERIOD);
  const csv = statementToCsv(statement);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'timestamp,type,asset,amount,fee,status,memo');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith('2026-03-01 10:00:00,deposit,USDT,100,0,completed,'));

  const report = buildTaxReport(userId, PERIOD);
  const taxCsv = taxReportToCsv(report);
  const taxLines = taxCsv.split('\n');
  assert.equal(taxLines[0], 'asset,realized_pnl,fees');
  assert.equal(taxLines[taxLines.length - 1], 'TOTAL,0.00000000,0.00000000');
});
