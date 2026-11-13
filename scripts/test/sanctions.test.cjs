'use strict';
/**
 * Sanctions screening tests against a real database.
 *
 * Screening must fail closed: with enforcement on and no list loaded, a
 * transaction is refused rather than allowed. These tests pin that behaviour and
 * the match path.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-sanctions-')), 'sanctions.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';
process.env.TIGEREX_SANCTIONS_ENFORCE = 'true';

const {
  normaliseSubject,
  screenSubject,
  assertNotSanctioned,
  addSanctionsEntry,
  validateSanctionsEntry,
  markSanctionsListLoaded,
  sanctionsListLoaded,
  SanctionsError,
} = require('../../.test-build/sanctions.js');

test('normalisation folds address case and collapses name whitespace', () => {
  assert.equal(normaliseSubject('0xABCDEF0123456789ABCDEF0123456789ABCDEF01'), '0xabcdef0123456789abcdef0123456789abcdef01');
  assert.equal(normaliseSubject('  Ivan   Petrov '), 'ivan petrov');
});

test('an unloaded list refuses a transaction under enforcement', () => {
  assert.equal(sanctionsListLoaded(), false);
  assert.throws(() => assertNotSanctioned('0x1111111111111111111111111111111111111111'), (error) => {
    assert.ok(error instanceof SanctionsError);
    assert.equal(error.code, 'SANCTIONS_LIST_NOT_LOADED');
    return true;
  });
});

test('a listed address is refused', () => {
  const entryId = addSanctionsEntry(
    validateSanctionsEntry({
      value: '0x2222222222222222222222222222222222222222',
      kind: 'address',
      listName: 'OFAC-SDN',
      reason: 'test entry',
    }),
  );
  assert.ok(entryId);

  const screen = screenSubject('0x2222222222222222222222222222222222222222');
  assert.equal(screen.matched, true);
  assert.equal(screen.matches[0].listName, 'OFAC-SDN');

  assert.throws(() => assertNotSanctioned('0x2222222222222222222222222222222222222222'), (error) => {
    assert.equal(error.code, 'SANCTIONED');
    return true;
  });
});

test('a loaded list with no match passes', () => {
  markSanctionsListLoaded(true);
  assert.equal(sanctionsListLoaded(), true);
  const screen = assertNotSanctioned('0x3333333333333333333333333333333333333333');
  assert.equal(screen.matched, false);
  assert.equal(screen.listLoaded, true);
});

test('adding the same entry twice is idempotent', () => {
  const input = validateSanctionsEntry({ value: '0x4444444444444444444444444444444444444444', kind: 'address', listName: 'EU' });
  const first = addSanctionsEntry(input);
  const second = addSanctionsEntry(input);
  assert.equal(first, second);
});

test('an invalid entry is rejected', () => {
  assert.throws(() => validateSanctionsEntry({ value: '', kind: 'address', listName: 'X' }), (e) => e.code === 'VALIDATION_FAILED');
  assert.throws(() => validateSanctionsEntry({ value: 'abc', kind: 'bogus', listName: 'X' }), (e) => e.code === 'VALIDATION_FAILED');
  assert.throws(() => validateSanctionsEntry({ value: '0x5555555555555555555555555555555555555555', kind: 'address', listName: '' }), (e) => e.code === 'VALIDATION_FAILED');
});
