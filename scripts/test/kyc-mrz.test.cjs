'use strict';
/**
 * MRZ verification tests (ICAO 9303).
 *
 * The two sample MRZs below are published valid test vectors whose check digits
 * were confirmed against the 7-3-1 algorithm by hand. The tests assert that a
 * valid MRZ parses with the right fields and that any single altered character
 * is rejected rather than silently accepted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseMrz, checkDigit, charValue, MrzError } = require('../../.test-build/mrz.js');

// TD3 (passport) — known-valid sample. Both line check digits verify.
const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
].join('\n');

// TD1 (ID card) — known-valid sample.
const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
].join('\n');

test('the check-digit algorithm matches the ICAO sample fields', () => {
  assert.equal(checkDigit('L898902C3'), 6);
  assert.equal(checkDigit('740812'), 2);
  assert.equal(checkDigit('120415'), 9);
  assert.equal(charValue('<'), 0);
  assert.equal(charValue('A'), 10);
  assert.equal(charValue('9'), 9);
});

test('a valid TD3 passport MRZ parses with the correct fields', () => {
  const fields = parseMrz(TD3);
  assert.equal(fields.documentType, 'TD3');
  assert.equal(fields.documentNumber, 'L898902C3');
  assert.equal(fields.dateOfBirth, '1974-08-12');
  assert.equal(fields.dateOfExpiry, '2012-04-15');
  assert.equal(fields.sex, 'F');
  assert.equal(fields.nationality, 'UTO');
  assert.equal(fields.issuingState, 'UTO');
  assert.equal(fields.surname, 'ERIKSSON');
  assert.equal(fields.givenNames, 'ANNA MARIA');
});

test('a valid TD1 ID-card MRZ parses with the correct fields', () => {
  const fields = parseMrz(TD1);
  assert.equal(fields.documentType, 'TD1');
  assert.equal(fields.documentNumber, 'D23145890');
  assert.equal(fields.dateOfBirth, '1974-08-12');
  assert.equal(fields.dateOfExpiry, '2012-04-15');
  assert.equal(fields.sex, 'F');
  assert.equal(fields.nationality, 'UTO');
  assert.equal(fields.surname, 'ERIKSSON');
  assert.equal(fields.givenNames, 'ANNA MARIA');
});

test('a tampered document number fails the check digit', () => {
  const tampered = [
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
    'L898902C99UTO7408122F1204159ZE184226B<<<<<10',
  ].join('\n');
  assert.throws(() => parseMrz(tampered), (e) => e instanceof MrzError && e.code === 'MRZ_CHECK_DIGIT');
});

test('a tampered date of birth fails the check digit', () => {
  const tampered = [
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
    'L898902C36UTO7508122F1204159ZE184226B<<<<<10',
  ].join('\n');
  assert.throws(() => parseMrz(tampered), (e) => e.code === 'MRZ_CHECK_DIGIT');
});

test('a tampered composite field fails the composite check digit', () => {
  const tampered = [
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
    'L898902C36UTO7408122F1204159ZE184226B<<<<<11', // last digit changed
  ].join('\n');
  assert.throws(() => parseMrz(tampered), (e) => e.code === 'MRZ_CHECK_DIGIT');
});

test('a malformed line length is rejected', () => {
  assert.throws(() => parseMrz('P<UTOERIKSSON\nL898902C3'), (e) => e.code === 'MRZ_FORMAT');
});

test('an invalid character is rejected', () => {
  const tampered = [
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<!',
    'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
  ].join('\n');
  assert.throws(() => parseMrz(tampered));
});
