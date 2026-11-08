'use strict';
/** Password policy tests: the shared rule set used by register, reset and change. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { checkPassword, isStrongPassword } = require('../../.test-build/password.js');

test('accepts a password that meets every rule', () => {
  const result = checkPassword('Str0ng-Passphrase!42');
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.deepEqual(result.problems, []);
  assert.equal(isStrongPassword('Str0ng-Passphrase!42'), true);
});

test('rejects a short password and says why', () => {
  const result = checkPassword('Ab1!x');
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /At least 10 characters/.test(p)));
});

test('rejects a password missing each character class', () => {
  assert.equal(checkPassword('alllowercase1!').ok, false);
  assert.equal(checkPassword('ALLUPPERCASE1!').ok, false);
  assert.equal(checkPassword('NoDigitsHere!!').ok, false);
  assert.equal(checkPassword('NoSpecial12345').ok, false);
});

test('rejects a repeated-character password', () => {
  assert.equal(checkPassword('aaaaaaaaaaaaA1!').ok, false);
});

test('rejects common passwords even when they look complex', () => {
  assert.equal(checkPassword('Password123').ok, false);
  assert.equal(checkPassword('password123').ok, false);
});

test('rejects an over-long password', () => {
  assert.equal(checkPassword(`Aa1!${'x'.repeat(300)}`).ok, false);
});

test('reports every problem at once', () => {
  const result = checkPassword('abc');
  assert.equal(result.ok, false);
  assert.ok(result.problems.length >= 3);
});

test('handles empty and non-string input without throwing', () => {
  assert.equal(checkPassword('').ok, false);
  assert.equal(checkPassword(undefined).ok, false);
  assert.equal(checkPassword(null).ok, false);
});
