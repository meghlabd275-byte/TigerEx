'use strict';
/**
 * Structural input validation.
 *
 * A parsed JSON body must be rejected when it carries a prototype-pollution key,
 * exceeds a depth/size bound, or holds a control character — and accepted when
 * it is an ordinary bounded object. The guard fails closed, so a violation is an
 * error, never a silent truncation.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateJsonInput,
  isJsonInputValid,
  InputValidationError,
  DEFAULT_INPUT_LIMITS,
} = require('../../.test-build/input-guard.js');

test('a plain bounded object is accepted', () => {
  assert.doesNotThrow(() =>
    validateJsonInput({ symbol: 'BTC/USDT', side: 'buy', amount: 1.5, nested: { ok: [1, 2, 3] } }),
  );
  assert.equal(isJsonInputValid({ a: 1, b: 'two' }), true);
});

test('__proto__ / constructor / prototype keys are rejected', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const body = JSON.parse(`{"${key}": {"polluted": true}}`);
    assert.throws(
      () => validateJsonInput(body),
      (error) => error instanceof InputValidationError && error.code === 'INPUT_FORBIDDEN_KEY',
      `${key} must be rejected`,
    );
    assert.equal(isJsonInputValid(body), false);
  }
});

test('a nested forbidden key is rejected, not just a top-level one', () => {
  const body = { order: { meta: { __proto__: { admin: true } } } };
  // Assigning __proto__ in an object literal sets the prototype; use defineProperty
  // to create a genuine own key the way JSON.parse would.
  const hostile = JSON.parse('{"order":{"meta":{"__proto__":{"admin":true}}}}');
  assert.throws(() => validateJsonInput(hostile), (error) => error.code === 'INPUT_FORBIDDEN_KEY');
  // A benign nested object is fine.
  assert.doesNotThrow(() => validateJsonInput(body));
});

test('depth beyond the limit is rejected', () => {
  let deep = {};
  let cursor = deep;
  for (let i = 0; i < DEFAULT_INPUT_LIMITS.maxDepth + 5; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.throws(() => validateJsonInput(deep), (error) => error.code === 'INPUT_TOO_DEEP');
});

test('an over-long array is rejected', () => {
  const long = new Array(DEFAULT_INPUT_LIMITS.maxArrayLength + 1).fill(0);
  assert.throws(() => validateJsonInput({ items: long }), (error) => error.code === 'INPUT_ARRAY_TOO_LONG');
});

test('an over-long string is rejected', () => {
  const huge = 'a'.repeat(DEFAULT_INPUT_LIMITS.maxStringLength + 1);
  assert.throws(() => validateJsonInput({ note: huge }), (error) => error.code === 'INPUT_STRING_TOO_LONG');
});

test('a control character in a string is rejected, but tab/newline are allowed', () => {
  assert.throws(
    () => validateJsonInput({ memo: 'line\u0000null' }),
    (error) => error.code === 'INPUT_CONTROL_CHAR',
  );
  assert.doesNotThrow(() => validateJsonInput({ memo: 'ok\tline\nbreak\r' }));
});

test('a non-finite number is rejected', () => {
  assert.throws(() => validateJsonInput({ amount: Number.POSITIVE_INFINITY }), (error) => error.code === 'INPUT_INVALID_NUMBER');
  assert.throws(() => validateJsonInput({ amount: Number.NaN }), (error) => error.code === 'INPUT_INVALID_NUMBER');
});

test('too many keys is rejected', () => {
  const many = {};
  for (let i = 0; i < DEFAULT_INPUT_LIMITS.maxKeys + 1; i += 1) many[`k${i}`] = i;
  assert.throws(() => validateJsonInput(many), (error) => error.code === 'INPUT_TOO_MANY_KEYS');
});

test('limits can be overridden per call', () => {
  assert.throws(
    () => validateJsonInput({ a: { b: { c: 1 } } }, { maxDepth: 1 }),
    (error) => error.code === 'INPUT_TOO_DEEP',
  );
  assert.doesNotThrow(() => validateJsonInput({ a: { b: { c: 1 } } }, { maxDepth: 5 }));
});

test('null and undefined are valid leaves', () => {
  assert.doesNotThrow(() => validateJsonInput(null));
  assert.doesNotThrow(() => validateJsonInput({ a: null, b: undefined }));
});
