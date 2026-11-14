'use strict';
/**
 * AML/CFT case management and regulatory reporting, against a real database.
 *
 * A case must be opened only from a recorded signal, must dedupe a repeat scan,
 * must require a resolution to close and refuse to reopen once closed, and a
 * report must be filed once with a hash that matches its payload.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-aml-')), 'aml.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const {
  openCase,
  getCase,
  listCases,
  updateCase,
  fileReport,
  listReports,
  reportTypeForCase,
  structuringSignal,
  scanForAmlCases,
  CTR_THRESHOLD_USD,
  STRUCTURING_MIN_COUNT,
  AmlError,
} = require('../../.test-build/aml.js');

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

function seedWithdrawal(userId, amountUsd, whenIso = null) {
  db.prepare(
    `INSERT INTO withdrawals (withdrawal_id, user_id, currency, network, amount, fee, address, status, amount_usd, created_at)
     VALUES (?, ?, 'USDT', 'TIGEREX', ?, 0, '0xabc', 'pending', ?, COALESCE(?, datetime('now')))`,
  ).run(generateId(), userId, amountUsd, amountUsd, whenIso);
}

test('a case opens from a signal and carries its score and priority', () => {
  const userId = seedUser();
  const created = openCase({
    userId,
    source: 'surveillance',
    summary: 'test signal',
    signals: [{ source: 'surveillance', kind: 'wash_trading', score: 0.9, detail: {} }],
  });
  assert.equal(created.userId, userId);
  assert.equal(created.status, 'open');
  assert.equal(created.priority, 'critical');
  assert.equal(created.signals.length, 1);
  assert.equal(getCase(created.caseId).caseId, created.caseId);
});

test('a repeat scan returns the same open case rather than stacking duplicates', () => {
  const userId = seedUser();
  const first = openCase({
    userId,
    source: 'surveillance',
    summary: 'dedupe signal',
    signals: [{ source: 'surveillance', kind: 'spoofing', score: 0.4, detail: {} }],
  });
  const second = openCase({
    userId,
    source: 'surveillance',
    summary: 'dedupe signal',
    signals: [{ source: 'surveillance', kind: 'spoofing', score: 0.4, detail: {} }],
  });
  assert.equal(second.caseId, first.caseId);
  assert.equal(second.signals.length, 2);
  assert.equal(listCases({ userId }).length, 1);
});

test('closing requires a resolution, and a closed case cannot be reopened', () => {
  const userId = seedUser();
  const c = openCase({
    userId,
    source: 'withdrawal',
    summary: 'closure test',
    signals: [{ source: 'withdrawal', kind: 'large_transaction', score: 0.7, detail: {} }],
  });
  assert.throws(() => updateCase(c.caseId, { status: 'closed' }), (error) => error.code === 'RESOLUTION_REQUIRED');
  const closed = updateCase(c.caseId, { status: 'closed', resolution: 'no further action' });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.resolution, 'no further action');
  assert.ok(closed.closedAt);
  assert.throws(
    () => updateCase(c.caseId, { status: 'investigating' }),
    (error) => error instanceof AmlError && error.code === 'CASE_CLOSED',
  );
});

test('a large single transfer is reportable as a CTR, a high-score case as a SAR', () => {
  const userId = seedUser();
  const large = openCase({
    userId,
    source: 'withdrawal',
    summary: 'large',
    signals: [{ source: 'withdrawal', kind: 'large_transaction', score: 0.5, detail: {} }],
  });
  assert.equal(reportTypeForCase(large), 'CTR');
  const suspicious = openCase({
    userId,
    source: 'surveillance',
    summary: 'suspicious',
    signals: [{ source: 'surveillance', kind: 'wash_trading', score: 0.8, detail: {} }],
  });
  assert.equal(reportTypeForCase(suspicious), 'SAR');
});

test('filing a report is idempotent and the hash matches the payload', () => {
  const userId = seedUser();
  const c = openCase({
    userId,
    source: 'surveillance',
    summary: 'file test',
    signals: [{ source: 'surveillance', kind: 'wash_trading', score: 0.8, detail: {} }],
  });
  const first = fileReport({ caseId: c.caseId, jurisdiction: 'US', filedBy: 'officer@example.com' });
  assert.equal(first.created, true);
  const second = fileReport({ caseId: c.caseId, jurisdiction: 'US', filedBy: 'officer@example.com' });
  assert.equal(second.created, false);
  assert.equal(second.reportId, first.reportId);

  const reports = listReports({ userId });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].reportType, 'SAR');
  assert.equal(reports[0].payloadHash, first.payloadHash);

  // The stored payload hashes to the stored hash.
  const { createHash } = require('node:crypto');
  const row = db.prepare('SELECT payload, payload_hash FROM regulatory_reports WHERE report_id = ?').get(first.reportId);
  const recomputed = createHash('sha256').update(row.payload).digest('hex');
  assert.equal(recomputed, row.payload_hash);
});

test('structuring is several just-under transfers inside the window', () => {
  const userId = seedUser();
  const under = CTR_THRESHOLD_USD * 0.95;
  for (let i = 0; i < STRUCTURING_MIN_COUNT; i += 1) seedWithdrawal(userId, under);
  const signal = structuringSignal(userId);
  assert.ok(signal);
  assert.equal(signal.kind, 'structuring');
  assert.equal(signal.detail.count, STRUCTURING_MIN_COUNT);

  // A user with too few just-under transfers has no structuring signal.
  const quiet = seedUser();
  seedWithdrawal(quiet, under);
  assert.equal(structuringSignal(quiet), null);
});

test('scanForAmlCases opens cases from surveillance alerts and large withdrawals', () => {
  const flagged = seedUser();
  db.prepare(
    `INSERT INTO surveillance_alerts (alert_id, kind, symbol, user_id, score, detail, bucket, status, window_start, window_end)
     VALUES (?, 'wash_trading', 'BTC/USDT', ?, 0.75, '{}', 'b1', 'open', datetime('now'), datetime('now'))`,
  ).run(generateId(), flagged);

  const big = seedUser();
  seedWithdrawal(big, CTR_THRESHOLD_USD + 1);

  const cases = scanForAmlCases();
  assert.ok(cases.some((c) => c.userId === flagged && c.source === 'surveillance'));
  assert.ok(cases.some((c) => c.userId === big && c.source === 'withdrawal'));

  // A second scan touches the same cases, it does not create new ones.
  const before = listCases({}).length;
  scanForAmlCases();
  assert.equal(listCases({}).length, before);
});

test('a case that meets no threshold has no report due', () => {
  const userId = seedUser();
  const c = openCase({
    userId,
    source: 'withdrawal',
    summary: 'below threshold',
    signals: [{ source: 'withdrawal', kind: 'structuring', score: 0.55, detail: {} }],
  });
  assert.equal(reportTypeForCase(c), null);
  assert.throws(() => fileReport({ caseId: c.caseId, jurisdiction: 'US', filedBy: 'x' }), (error) => error.code === 'NO_REPORT_DUE');
});
