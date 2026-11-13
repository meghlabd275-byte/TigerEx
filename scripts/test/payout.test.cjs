'use strict';
/**
 * Payout transaction-building tests.
 *
 * The transaction builder is the last step before funds leave, so these tests
 * pin the amount conversion (no floating-point drift) and that a signed
 * transaction carries exactly the intended recipient and value.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { toBaseUnits, signPayout, PayoutError } = require('../../.test-build/payout.js');

test('toBaseUnits converts without floating-point drift', () => {
  assert.equal(toBaseUnits(1, 18), 10n ** 18n);
  assert.equal(toBaseUnits(0.1, 18), 10n ** 17n);
  assert.equal(toBaseUnits(1.5, 6), 1_500_000n);
  assert.equal(toBaseUnits(0, 18), 0n);
});

test('toBaseUnits refuses a negative or non-finite amount', () => {
  assert.throws(() => toBaseUnits(-1, 18), (e) => e instanceof PayoutError && e.code === 'INVALID_AMOUNT');
  assert.throws(() => toBaseUnits(NaN, 18), (e) => e instanceof PayoutError && e.code === 'INVALID_AMOUNT');
});

test('a signed native payout carries the exact recipient and value', async () => {
  const { Transaction } = require('ethers');
  // A fixed, well-known test key (private key 0x...01).
  const privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const raw = await signPayout(privateKey, {
    from: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
    to: '0x1111111111111111111111111111111111111111',
    amount: 10n ** 18n,
    tokenContract: null,
    nonce: 7n,
    gasPrice: 20n * 10n ** 9n,
    gasLimit: 21000n,
    chainId: 1,
  });

  assert.match(raw, /^0x[0-9a-f]+$/i);
  const parsed = Transaction.from(raw);
  assert.equal(parsed.to.toLowerCase(), '0x1111111111111111111111111111111111111111');
  assert.equal(parsed.value, 10n ** 18n);
  assert.equal(parsed.nonce, 7);
  assert.equal(parsed.chainId, 1n);
});

test('a signed ERC-20 payout targets the token contract with transfer calldata', async () => {
  const { Transaction } = require('ethers');
  const privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const raw = await signPayout(privateKey, {
    from: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
    to: '0x2222222222222222222222222222222222222222',
    amount: 1_000_000n,
    tokenContract: '0x3333333333333333333333333333333333333333',
    nonce: 0n,
    gasPrice: 1n,
    gasLimit: 100000n,
    chainId: 1,
  });

  const parsed = Transaction.from(raw);
  assert.equal(parsed.to.toLowerCase(), '0x3333333333333333333333333333333333333333');
  assert.equal(parsed.value, 0n);
  // selector for transfer(address,uint256)
  assert.ok(parsed.data.startsWith('0xa9059cbb'));
});
