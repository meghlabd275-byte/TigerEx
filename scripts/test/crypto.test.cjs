'use strict';
/**
 * Tests for the at-rest secret and credential helpers in `src/lib/db`.
 *
 * These guard real value: an API secret and a TOTP seed are stored encrypted,
 * and a password is stored as a bcrypt hash. The failure modes that matter are
 * (a) a wrong key silently decrypting to garbage instead of failing, (b) a
 * tampered ciphertext not being detected, and (c) a malformed stored value
 * throwing an opaque error rather than a clear fail-closed one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const BUILD = path.join(__dirname, '..', '..', '.test-build');
const { encrypt, decrypt, hashPassword, verifyPassword, generateToken, generateOTP } = require(
  path.join(BUILD, 'index.js'),
);

test('a secret round-trips through AES-256-GCM', () => {
  const secret = 'JBSWY3DPEHPK3PXP'; // a TOTP seed shape
  const stored = encrypt(secret);
  assert.notEqual(stored, secret);
  // iv:authTag:ciphertext, each segment non-empty.
  const parts = stored.split(':');
  assert.equal(parts.length, 3);
  assert.equal(Buffer.from(parts[0], 'hex').length, 16);
  assert.equal(Buffer.from(parts[1], 'hex').length, 16);
  assert.equal(decrypt(stored), secret);
});

test('a fresh nonce is used each time, so equal plaintexts differ at rest', () => {
  const a = encrypt('same-secret');
  const b = encrypt('same-secret');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'same-secret');
  assert.equal(decrypt(b), 'same-secret');
});

test('a tampered ciphertext is rejected, not decrypted to garbage', () => {
  const stored = encrypt('tamper-me');
  const [iv, tag, body] = stored.split(':');
  // Flip the last ciphertext nibble.
  const flipped = body.slice(0, -1) + (body.slice(-1) === '0' ? '1' : '0');
  assert.throws(() => decrypt(`${iv}:${tag}:${flipped}`));
});

test('a value encrypted under a different key does not decrypt', () => {
  const stored = encrypt('cross-key');
  process.env.ENCRYPTION_KEY = 'a-different-key-abcdefabcdefabcdefabcdef';
  try {
    assert.throws(() => decrypt(stored));
  } finally {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';
  }
});

test('a malformed stored value fails closed with a clear error', () => {
  assert.throws(() => decrypt('not-a-valid-payload'), /malformed/);
  assert.throws(() => decrypt('only:two'), /malformed/);
  assert.throws(() => decrypt('aa:bb:cc'), /invalid IV or authentication tag/);
  assert.throws(() => decrypt(''), /malformed/);
});

test('a short encryption key is refused rather than silently used', () => {
  const original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'too-short';
  try {
    assert.throws(() => encrypt('x'), /ENCRYPTION_KEY/);
  } finally {
    process.env.ENCRYPTION_KEY = original;
  }
});

test('passwords are stored as a bcrypt hash and verified, never in the clear', () => {
  const password = 'correct horse battery staple';
  const hash = hashPassword(password);
  assert.notEqual(hash, password);
  assert.match(hash, /^\$2[aby]\$/);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
});

test('tokens and OTPs are unpredictable and correctly shaped', () => {
  const token = generateToken();
  assert.equal(token.length, 64); // 32 random bytes as hex
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.notEqual(generateToken(), generateToken());

  for (let i = 0; i < 50; i += 1) {
    const otp = generateOTP();
    assert.match(otp, /^\d{6}$/);
    assert.ok(Number(otp) >= 100000 && Number(otp) < 1000000);
  }
});
