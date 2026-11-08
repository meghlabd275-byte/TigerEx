'use strict';
/**
 * Deposit network tests against a real database.
 *
 * A deposit address is only issued for an asset/network pair listed active in
 * `deposit_networks`. These tests configure real rows and assert the real
 * decisions: an unlisted chain is refused before the custody seed is consulted,
 * a paused chain is refused, a listed chain derives an address once the seed is
 * present, and a chain already holding addresses cannot be deleted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-networks-')), 'networks.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';
// A real BIP-39 test vector so address derivation actually runs.
process.env.TIGEREX_CUSTODY_MNEMONIC =
  'test test test test test test test test test test test junk';

const { getDb, generateId } = require('../../.test-build/index.js');
const {
  validateNetworkInput,
  upsertNetwork,
  listNetworks,
  activeNetworksFor,
  networkEnabled,
  removeNetwork,
  NetworkError,
} = require('../../.test-build/networks.js');
const { depositAddress, DepositError } = require('../../.test-build/deposit.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, 'x', 'active')`,
  ).run(userId, `${userId}@example.com`);
  return userId;
}

test('validateNetworkInput normalises and rejects bad rows', () => {
  const ok = validateNetworkInput({
    asset: 'btc',
    network: 'erc20',
    displayName: 'Ethereum (ERC20)',
    minDeposit: '0.0005',
    confirmations: '12',
  });
  assert.ok('network' in ok);
  assert.equal(ok.network.asset, 'BTC');
  assert.equal(ok.network.network, 'ERC20');
  assert.equal(ok.network.minDeposit, 0.0005);
  assert.equal(ok.network.confirmations, 12);
  assert.equal(ok.network.memoRequired, false);
  assert.equal(ok.network.status, 'active');

  assert.ok('error' in validateNetworkInput({ asset: 'BTC', network: 'ERC20', displayName: 'x', minDeposit: 0, confirmations: 1 }));
  assert.ok('error' in validateNetworkInput({ asset: 'BTC', network: 'ERC20', displayName: 'x', minDeposit: 1, confirmations: 1.5 }));
  assert.ok('error' in validateNetworkInput({ asset: 'BTC', network: 'ERC20', displayName: '', minDeposit: 1, confirmations: 1 }));
  assert.ok('error' in validateNetworkInput({ asset: 'BTC', network: 'ERC20', displayName: 'x', minDeposit: 1, confirmations: 1, status: 'live' }));
  assert.ok('error' in validateNetworkInput({ asset: 'B T C', network: 'ERC20', displayName: 'x', minDeposit: 1, confirmations: 1 }));
});

test('upsertNetwork stores a row and lists it as active', () => {
  const stored = upsertNetwork({
    asset: 'btc',
    network: 'erc20',
    displayName: 'Ethereum (ERC20)',
    minDeposit: 0.0005,
    confirmations: 12,
  });
  assert.equal(stored.asset, 'BTC');

  assert.equal(networkEnabled('BTC', 'ERC20'), true);
  assert.equal(networkEnabled('btc', 'erc20'), true);
  assert.equal(networkEnabled('BTC', 'TRC20'), false);

  const active = activeNetworksFor('BTC');
  assert.equal(active.length, 1);
  assert.equal(active[0].displayName, 'Ethereum (ERC20)');

  // Updating the same pair does not create a second row.
  upsertNetwork({ asset: 'BTC', network: 'ERC20', displayName: 'ETH', minDeposit: 0.001, confirmations: 20 });
  assert.equal(listNetworks().length, 1);
  assert.equal(activeNetworksFor('BTC')[0].confirmations, 20);
});

test('a paused network is not offered and is not enabled', () => {
  upsertNetwork({ asset: 'ETH', network: 'ERC20', displayName: 'Ethereum', minDeposit: 0.01, confirmations: 12 });
  upsertNetwork({ asset: 'ETH', network: 'ERC20', displayName: 'Ethereum', minDeposit: 0.01, confirmations: 12, status: 'paused' });

  assert.equal(networkEnabled('ETH', 'ERC20'), false);
  assert.equal(activeNetworksFor('ETH').length, 0);
  assert.equal(listNetworks().length, 2); // still listed for the console
});

test('depositAddress refuses an unlisted network before touching custody', () => {
  const userId = seedUser();
  assert.throws(
    () => depositAddress(userId, 'DOGE', 'DOGECHAIN'),
    (error) => error instanceof DepositError && error.code === 'UNSUPPORTED_NETWORK' && error.status === 409,
  );
});

test('depositAddress refuses a paused network', () => {
  const userId = seedUser();
  assert.throws(
    () => depositAddress(userId, 'ETH', 'ERC20'),
    (error) => error instanceof DepositError && error.code === 'UNSUPPORTED_NETWORK',
  );
});

test('depositAddress derives a real EVM address for a listed network and reuses it', () => {
  const userId = seedUser();
  const first = depositAddress(userId, 'BTC', 'ERC20');
  assert.match(first.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(first.created, true);

  const second = depositAddress(userId, 'BTC', 'ERC20');
  assert.equal(second.address, first.address);
  assert.equal(second.created, false);
});

test('removeNetwork refuses a chain that already holds addresses', () => {
  // BTC/ERC20 now has an address from the previous test.
  assert.throws(
    () => removeNetwork('BTC', 'ERC20'),
    (error) => error instanceof NetworkError && error.code === 'NETWORK_IN_USE' && error.status === 409,
  );
});

test('removeNetwork deletes an unused chain and a missing one is not found', () => {
  upsertNetwork({ asset: 'SOL', network: 'SOL', displayName: 'Solana', minDeposit: 0.01, confirmations: 1 });
  removeNetwork('SOL', 'SOL');
  assert.equal(networkEnabled('SOL', 'SOL'), false);

  assert.throws(
    () => removeNetwork('SOL', 'SOL'),
    (error) => error instanceof NetworkError && error.code === 'NOT_FOUND' && error.status === 404,
  );
});
