'use strict';
/**
 * Deposit scanner codec tests.
 *
 * The scanner decides which transfers to credit, so the log decoder must read a
 * real ERC-20 Transfer log correctly and reject anything malformed rather than
 * crediting a mis-parsed amount.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ERC20_TRANSFER_TOPIC,
  decodeTransferLog,
  topicToAddress,
} = require('../../.test-build/evm-rpc.js');

function transferLog(from, to, valueHex) {
  return {
    address: '0x9999999999999999999999999999999999999999',
    topics: [
      ERC20_TRANSFER_TOPIC,
      `0x${from.slice(2).toLowerCase().padStart(64, '0')}`,
      `0x${to.slice(2).toLowerCase().padStart(64, '0')}`,
    ],
    data: `0x${valueHex.padStart(64, '0')}`,
    blockNumber: '0x10',
    transactionHash: '0xabc',
    logIndex: '0x0',
  };
}

test('a well-formed Transfer log decodes to from, to and value', () => {
  const log = transferLog('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'de0b6b3a7640000');
  const decoded = decodeTransferLog(log);
  assert.ok(decoded);
  assert.equal(decoded.from, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(decoded.to, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(decoded.value, 10n ** 18n);
});

test('a log with the wrong topic is rejected', () => {
  const log = transferLog('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', '1');
  log.topics[0] = `0x${'00'.repeat(32)}`;
  assert.equal(decodeTransferLog(log), null);
});

test('a log with too few topics is rejected', () => {
  const log = transferLog('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', '1');
  log.topics = log.topics.slice(0, 2);
  assert.equal(decodeTransferLog(log), null);
});

test('topicToAddress reads the trailing 20 bytes', () => {
  assert.equal(
    topicToAddress(`0x${'00'.repeat(12)}${'ab'.repeat(20)}`),
    `0x${'ab'.repeat(20)}`,
  );
  assert.equal(topicToAddress('0x1234'), null);
});
