'use strict';
/**
 * Health and metrics tests against a real database.
 *
 * A probe that reports healthy while the database is unreachable is worse than
 * no probe, so these tests assert the failure path as well as the success path,
 * and that the metrics renderer never emits a fabricated or non-finite series.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-health-')), 'health.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId } = require('../../.test-build/index.js');
const { checkDatabase, checkMarketsListed, readiness, liveness, healthReport } = require('../../.test-build/health.js');
const { collectMetrics, renderPrometheus } = require('../../.test-build/metrics.js');

test('database probe is ok against a live database', () => {
  const result = checkDatabase();
  assert.equal(result.status, 'ok');
  assert.equal(typeof result.latencyMs, 'number');
});

test('readiness fails closed when no market is listed', () => {
  const result = checkMarketsListed();
  assert.equal(result.status, 'fail');
  assert.match(String(result.detail), /no active trading pairs/);

  const report = readiness(Date.now());
  assert.equal(report.status, 'fail');
  assert.equal(report.checks.database.status, 'ok');
  assert.equal(report.checks.markets.status, 'fail');
});

test('readiness turns ok once a market is listed', () => {
  getDb()
    .prepare(
      `INSERT INTO trading_pairs (pair_id, base_currency, quote_currency, symbol, status)
       VALUES (?, 'BTC', 'RUSD', 'BTC/RUSD', 'active')`,
    )
    .run(generateId());

  assert.equal(checkMarketsListed().status, 'ok');
  assert.equal(readiness(Date.now()).status, 'ok');
});

test('liveness is always ok and reports uptime', () => {
  const report = liveness(Date.now() - 5000);
  assert.equal(report.status, 'ok');
  assert.ok(report.uptimeSeconds >= 5);
});

test('an aggregate is only ok when every required check passes', () => {
  const report = healthReport(
    { database: { status: 'ok' }, markets: { status: 'fail' } },
    ['database'],
    Date.now(),
  );
  assert.equal(report.status, 'ok');

  const strict = healthReport(
    { database: { status: 'ok' }, markets: { status: 'fail' } },
    ['database', 'markets'],
    Date.now(),
  );
  assert.equal(strict.status, 'fail');
});

test('metrics render real counts and omit non-finite values', () => {
  const samples = collectMetrics();
  const rendered = renderPrometheus(samples);
  assert.match(rendered, /# TYPE tigerex_users_total gauge/);
  assert.match(rendered, /# TYPE tigerex_orders_total counter/);
  assert.match(rendered, /tigerex_pairs_active_total 1/);

  const withNaN = renderPrometheus([{ name: 'x', help: 'h', type: 'gauge', value: NaN }]);
  assert.equal(withNaN.trim(), '');
});
