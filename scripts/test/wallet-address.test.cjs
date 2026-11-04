'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const BUILD = path.join(__dirname, '..', '..', '.test-build');
const address = require(path.join(BUILD, 'address.js'));

test('Keccak-256 matches the published empty-string digest', () => {
  assert.equal(
    address.keccak256Hex(''),
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  );
});

test('Keccak-256 matches the published "abc" digest', () => {
  assert.equal(
    address.keccak256Hex('abc'),
    '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  );
});

test('EIP-55 checksumming reproduces the reference vectors', () => {
  // From EIP-55 itself.
  const vectors = [
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ];
  for (const vector of vectors) {
    assert.equal(address.toChecksumAddress(vector.toLowerCase()), vector);
    assert.equal(address.isEvmAddress(vector), true);
  }
});

test('an EVM address with a broken checksum is rejected', () => {
  // Same address as the first vector, with one letter's case flipped.
  assert.equal(address.isEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'), false);
  const result = address.validateAddress('ERC20', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD');
  assert.equal(result.valid, false);
  assert.match(result.reason, /checksum/);
});

test('an all-lowercase EVM address is accepted and normalised to its checksum', () => {
  const result = address.validateAddress('ERC20', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
  assert.equal(result.valid, true);
  assert.equal(result.normalized, '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
});

test('Base58Check round-trips and rejects a flipped character', () => {
  const payload = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(20, 0x11)]);
  const encoded = address.base58CheckEncode(payload);
  assert.deepEqual(address.base58CheckDecode(encoded), payload);

  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const flipped =
    encoded.slice(0, -1) + alphabet[(alphabet.indexOf(encoded[encoded.length - 1]) + 1) % 58];
  assert.equal(address.base58CheckDecode(flipped), null);
});

test('a real Bitcoin mainnet P2PKH address validates and a BCH address does not', () => {
  // The genesis-block coinbase address; its checksum is fixed by the protocol.
  const genesis = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
  assert.equal(address.validateAddress('BTC', genesis).valid, true);
  assert.equal(address.validateAddress('BTC', genesis).normalized, genesis);
});

test('a Bech32 segwit address validates and a corrupted one does not', () => {
  const segwit = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  assert.equal(address.validateAddress('BTC', segwit).valid, true);
  const corrupted = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5';
  assert.equal(address.validateAddress('BTC', corrupted).valid, false);
});

test('a Solana address must decode to exactly 32 bytes', () => {
  const valid = '11111111111111111111111111111111';
  assert.equal(address.validateAddress('SOL', valid).valid, true);
  assert.equal(address.validateAddress('SOL', '1111').valid, false);
});

test('an unknown network fails closed rather than accepting the address', () => {
  const result = address.validateAddress('MADEUPCHAIN', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  assert.equal(result.valid, false);
  assert.match(result.reason, /not supported/);
});

test('whitespace and empty addresses are refused', () => {
  assert.equal(address.validateAddress('ERC20', '').valid, false);
  assert.equal(address.validateAddress('ERC20', '0x 5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed').valid, false);
});
