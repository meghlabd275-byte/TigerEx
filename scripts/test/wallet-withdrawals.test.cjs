'use strict';
/**
 * Withdrawal policy tests against a real database.
 *
 * The policy module reads its fees from `system_settings`, so these tests
 * configure real rows and assert the real decisions: a chain that was never
 * enabled is refused, a bad checksum is refused, the KYC tier cap is enforced
 * against the account's own withdrawal history, and an accepted request locks
 * the amount plus the fee in the ledger.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-withdrawals-')), 'withdrawals.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const {
  withdrawalPolicies,
  withdrawalPolicy,
  withdrawalUsage,
  limitForLevel,
  createWithdrawal,
  WithdrawalError,
} = require('../../.test-build/withdrawals.js');

const db = getDb();

const EVM_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

function seedUser(kycLevel = '0') {
  const userId = generateId();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, kyc_level, kyc_status, status)
     VALUES (?, ?, ?, ?, 'approved', 'active')`,
  ).run(userId, `${userId}@example.com`, hashPassword('password123'), kycLevel);
  return userId;
}

function fund(userId, asset, amount) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, asset);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, asset, amount);
}

function setFees(policies) {
  db.prepare(
    `INSERT INTO system_settings (key, value, category) VALUES ('withdrawal_fees', ?, 'operations')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(policies));
}

const USD_PRICE = () => 1;

test('a chain that was never configured is not withdrawable', () => {
  const user = seedUser();
  fund(user, 'BTC', 5);
  assert.equal(withdrawalPolicy('BTC', 'BTC'), null);
  assert.throws(
    () =>
      createWithdrawal({
        userId: user,
        kycLevel: '3',
        asset: 'BTC',
        network: 'BTC',
        amount: 1,
        fee: 0,
        address: EVM_ADDRESS,
        usdPrice: USD_PRICE,
      }),
    (error) => error instanceof WithdrawalError && error.code === 'CHAIN_NOT_CONFIGURED',
  );
});

test('a configured chain exposes its fee and minimum', () => {
  setFees({
    'RUSD:ERC20': { fee: 1.5, minAmount: 10, maxAmount: 100000, enabled: true },
  });
  const policy = withdrawalPolicy('rusd', 'erc20');
  assert.equal(policy.fee, 1.5);
  assert.equal(policy.minAmount, 10);
  assert.equal(policy.maxAmount, 100000);
  assert.equal(withdrawalPolicies().length, 1);
});

test('a withdrawal with a broken address checksum is refused and moves no funds', () => {
  setFees({ 'RUSD:ERC20': { fee: 1, minAmount: 1, enabled: true } });
  const user = seedUser();
  fund(user, 'RUSD', 1000);

  assert.throws(
    () =>
      createWithdrawal({
        userId: user,
        kycLevel: '3',
        asset: 'RUSD',
        network: 'ERC20',
        amount: 100,
        fee: 1,
        address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda95',
        usdPrice: USD_PRICE,
      }),
    (error) => error instanceof WithdrawalError && error.code === 'INVALID_ADDRESS',
  );
  assert.equal(availableBalance(user, 'RUSD'), 1000);
  assert.equal(lockedBalance(user, 'RUSD'), 0);
});

test('an amount below the configured minimum is refused', () => {
  setFees({ 'RUSD:ERC20': { fee: 1, minAmount: 50, enabled: true } });
  const user = seedUser();
  fund(user, 'RUSD', 1000);

  assert.throws(
    () =>
      createWithdrawal({
        userId: user,
        kycLevel: '3',
        asset: 'RUSD',
        network: 'ERC20',
        amount: 10,
        fee: 1,
        address: EVM_ADDRESS,
        usdPrice: USD_PRICE,
      }),
    (error) => error instanceof WithdrawalError && error.code === 'BELOW_MINIMUM',
  );
});

test('an accepted withdrawal locks the amount plus the fee and records the row', () => {
  setFees({ 'RUSD:ERC20': { fee: 2, minAmount: 1, enabled: true } });
  const user = seedUser('3');
  fund(user, 'RUSD', 1000);

  const result = createWithdrawal({
    userId: user,
    kycLevel: '3',
    asset: 'RUSD',
    network: 'ERC20',
    amount: 100,
    fee: 2,
    address: EVM_ADDRESS,
    usdPrice: USD_PRICE,
  });

  assert.equal(result.total, 102);
  assert.equal(result.status, 'pending');
  assert.equal(availableBalance(user, 'RUSD'), 898);
  assert.equal(lockedBalance(user, 'RUSD'), 102);

  const row = db.prepare('SELECT currency, amount, fee, status, address FROM withdrawals WHERE withdrawal_id = ?').get(
    result.withdrawalId,
  );
  assert.equal(row.currency, 'RUSD');
  assert.equal(row.amount, 100);
  assert.equal(row.fee, 2);
  assert.equal(row.status, 'pending');
  assert.equal(row.address, EVM_ADDRESS);
});

test('a withdrawal beyond the KYC tier daily cap is refused', () => {
  setFees({ 'RUSD:ERC20': { fee: 0, minAmount: 1, enabled: true } });
  // Level 0 has a 10,000 USD daily cap.
  const user = seedUser('0');
  fund(user, 'RUSD', 50000);

  assert.throws(
    () =>
      createWithdrawal({
        userId: user,
        kycLevel: '0',
        asset: 'RUSD',
        network: 'ERC20',
        amount: 20000,
        fee: 0,
        address: EVM_ADDRESS,
        usdPrice: USD_PRICE,
      }),
    (error) => error instanceof WithdrawalError && error.code === 'DAILY_LIMIT_EXCEEDED',
  );
  assert.equal(availableBalance(user, 'RUSD'), 50000);
});

test('the daily cap accounts for withdrawals already made today', () => {
  setFees({ 'RUSD:ERC20': { fee: 0, minAmount: 1, enabled: true } });
  const user = seedUser('0');
  fund(user, 'RUSD', 50000);

  // A completed withdrawal of 9,500 leaves only 500 of the 10,000 daily cap.
  db.prepare(
    `INSERT INTO withdrawals (withdrawal_id, user_id, currency, network, amount, fee, address, status, created_at)
     VALUES (?, ?, 'RUSD', 'ERC20', 9500, 0, ?, 'completed', datetime('now'))`,
  ).run(generateId(), user, EVM_ADDRESS);

  const usage = withdrawalUsage(user, '0', USD_PRICE);
  assert.equal(usage.dailyUsd, 9500);
  assert.equal(usage.remainingDailyUsd, 500);

  assert.throws(
    () =>
      createWithdrawal({
        userId: user,
        kycLevel: '0',
        asset: 'RUSD',
        network: 'ERC20',
        amount: 600,
        fee: 0,
        address: EVM_ADDRESS,
        usdPrice: USD_PRICE,
      }),
    (error) => error instanceof WithdrawalError && error.code === 'DAILY_LIMIT_EXCEEDED',
  );

  // 500 still fits.
  const ok = createWithdrawal({
    userId: user,
    kycLevel: '0',
    asset: 'RUSD',
    network: 'ERC20',
    amount: 500,
    fee: 0,
    address: EVM_ADDRESS,
    usdPrice: USD_PRICE,
  });
  assert.equal(ok.status, 'pending');
});

test('a rejected withdrawal does not consume the daily cap', () => {
  const user = seedUser('0');
  db.prepare(
    `INSERT INTO withdrawals (withdrawal_id, user_id, currency, network, amount, fee, address, status, created_at)
     VALUES (?, ?, 'RUSD', 'ERC20', 9500, 0, ?, 'rejected', datetime('now'))`,
  ).run(generateId(), user, EVM_ADDRESS);

  const usage = withdrawalUsage(user, '0', USD_PRICE);
  assert.equal(usage.dailyUsd, 0);
});

test('an unpriced asset cannot be measured against a USD cap, so it is refused', () => {
  setFees({ 'WIF:ERC20': { fee: 0, minAmount: 1, enabled: true } });
  const user = seedUser('3');
  fund(user, 'WIF', 100);

  assert.throws(
    () =>
      createWithdrawal({
        userId: user,
        kycLevel: '3',
        asset: 'WIF',
        network: 'ERC20',
        amount: 10,
        fee: 0,
        address: EVM_ADDRESS,
        usdPrice: () => null,
      }),
    (error) => error instanceof WithdrawalError && error.code === 'UNPRICED_ASSET',
  );
});

test('address locking refuses an address that is not saved, and allows a saved one', () => {
  setFees({ 'RUSD:ERC20': { fee: 1, minAmount: 1, enabled: true } });
  const user = seedUser('3');
  fund(user, 'RUSD', 1000);

  db.prepare('UPDATE users SET withdrawal_whitelist_enabled = 1 WHERE user_id = ?').run(user);

  // A valid but unsaved address is refused once the account locks its addresses.
  assert.throws(
    () =>
      createWithdrawal({
        userId: user,
        kycLevel: '3',
        asset: 'RUSD',
        network: 'ERC20',
        amount: 100,
        fee: 1,
        address: EVM_ADDRESS,
        usdPrice: USD_PRICE,
      }),
    (error) => error instanceof WithdrawalError && error.code === 'ADDRESS_NOT_WHITELISTED',
  );
  assert.equal(availableBalance(user, 'RUSD'), 1000);
  assert.equal(lockedBalance(user, 'RUSD'), 0);

  // Saving it in the address book unlocks exactly that address.
  db.prepare(
    `INSERT INTO withdrawal_whitelist (entry_id, user_id, asset, network, address, label, status)
     VALUES (?, ?, 'RUSD', 'ERC20', ?, NULL, 'active')`,
  ).run(generateId(), user, EVM_ADDRESS);

  const result = createWithdrawal({
    userId: user,
    kycLevel: '3',
    asset: 'RUSD',
    network: 'ERC20',
    amount: 100,
    fee: 1,
    address: EVM_ADDRESS,
    usdPrice: USD_PRICE,
  });
  assert.equal(result.status, 'pending');
  assert.equal(lockedBalance(user, 'RUSD'), 101);
});

test('the KYC limit tiers rise with the level', () => {
  const level0 = limitForLevel('none');
  const level3 = limitForLevel('3');
  assert.equal(level0.level, 0);
  assert.equal(level3.level, 3);
  assert.ok(level3.dailyWithdrawalUsd > level0.dailyWithdrawalUsd);
});
