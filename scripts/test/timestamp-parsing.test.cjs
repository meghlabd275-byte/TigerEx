'use strict';
/**
 * Timestamp parsing tests.
 *
 * The schema stores `datetime('now')` as `YYYY-MM-DD HH:MM:SS` with no zone
 * marker. `Date.parse` reads that as *local* time, so on any host that is not
 * set to UTC a raw parse shifts the value by the host offset. Withdrawals,
 * earn accrual, margin interest and challenge expiry all depend on this value
 * being UTC, so these tests pin the helper that reads it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Set a deliberately non-UTC zone before loading the module under test.
process.env.TZ = 'America/New_York';
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-ts-')), 'ts.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { parseUtcTimestamp } = require('../../.test-build/candles.js');

test('a zone-less datetime is read as UTC, not local time', () => {
  assert.equal(parseUtcTimestamp('2026-01-02 03:04:05'), Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.equal(parseUtcTimestamp('2026-01-02T03:04:05'), Date.UTC(2026, 0, 2, 3, 4, 5));
});

test('an ISO-8601 value with a zone marker keeps its own zone', () => {
  assert.equal(parseUtcTimestamp('2026-01-02T03:04:05.000Z'), Date.UTC(2026, 0, 2, 3, 4, 5));
});

test('the helper disagrees with a raw Date.parse of a zone-less value', () => {
  // On a non-UTC host a raw parse is shifted; the helper must not be.
  const raw = Date.parse('2026-01-02 03:04:05');
  const utc = parseUtcTimestamp('2026-01-02 03:04:05');
  assert.notEqual(raw, utc, 'this test is only meaningful off UTC; TZ must be applied');
  assert.equal(utc, Date.UTC(2026, 0, 2, 3, 4, 5));
});

test('a non-date value resolves to NaN rather than a wrong instant', () => {
  assert.ok(Number.isNaN(parseUtcTimestamp('not a date')));
});
