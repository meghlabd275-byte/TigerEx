'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const BUILD = path.join(__dirname, '..', '..', '.test-build');
const hd = require(path.join(BUILD, 'hd.js'));

// The BIP-39 reference mnemonic (all-zero entropy). Its BIP-32/BIP-44 keys are
// fixed by the standards, so these are real cross-implementation vectors, not
// values captured from this code.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('the BIP-39 seed for the reference mnemonic is the published seed', () => {
  const seed = hd.mnemonicToSeed(MNEMONIC);
  assert.equal(
    seed.toString('hex'),
    '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
  );
});

test('the secp256k1 public key for private key 1 is the generator point', () => {
  const compressed = hd.compressedPublicKey(1n);
  assert.equal(
    compressed.toString('hex'),
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  );
});

test('EVM derivation at m/44\'/60\'/0\'/0/0 matches the standard test vector', () => {
  assert.equal(hd.deriveEvmAddress(MNEMONIC, 0), '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
});

test('successive indexes produce distinct addresses', () => {
  const first = hd.deriveEvmAddress(MNEMONIC, 0);
  const second = hd.deriveEvmAddress(MNEMONIC, 1);
  const third = hd.deriveEvmAddress(MNEMONIC, 2);
  assert.notEqual(first, second);
  assert.notEqual(second, third);
  // m/44'/60'/0'/0/1 is also a published vector.
  assert.equal(second, '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
});

test('derivation is deterministic for the same seed and index', () => {
  assert.equal(hd.deriveEvmAddress(MNEMONIC, 7), hd.deriveEvmAddress(MNEMONIC, 7));
});

test('a malformed mnemonic is refused before any key material is produced', () => {
  assert.throws(() => hd.deriveEvmAddress('abandon abandon abandon', 0), /12, 15, 18, 21 or 24 words/);
  // BIP-39 mnemonics are case-insensitive, but a word list entry is letters only.
  assert.throws(() => hd.deriveEvmAddress(MNEMONIC.replace('about', 'ab0ut'), 0), /lowercase/);
});

test('a negative or out-of-range index is refused', () => {
  assert.throws(() => hd.deriveEvmAddress(MNEMONIC, -1), /31-bit/);
  assert.throws(() => hd.deriveEvmAddress(MNEMONIC, 0x80000000), /31-bit/);
});

test('only EVM networks are reported as derivable', () => {
  assert.equal(hd.isEvmNetwork('erc20'), true);
  assert.equal(hd.isEvmNetwork('bep20'), true);
  assert.equal(hd.isEvmNetwork('BTC'), false);
  assert.equal(hd.isEvmNetwork('SOL'), false);
});
