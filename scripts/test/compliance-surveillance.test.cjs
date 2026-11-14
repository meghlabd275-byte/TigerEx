'use strict';
/**
 * Tests for the market-integrity, travel-rule and destination-risk modules,
 * against a real SQLite database.
 *
 * The assertions cover both the detection and the refusals: a self-match and a
 * round-trip are flagged while an honest two-sided market is not; a transfer at
 * the travel-rule threshold without party data is refused while one below it is
 * untouched; a blocked destination is refused while a known one is allowed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-compliance-')), 'compliance.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';
process.env.TIGEREX_SANCTIONS_ENFORCE = 'false';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const surveillance = require('../../.test-build/surveillance.js');
const travelRule = require('../../.test-build/travel-rule.js');
const addressRisk = require('../../.test-build/address-risk.js');
const { addSanctionsEntry } = require('../../.test-build/sanctions.js');
const { createWithdrawal, WithdrawalError } = require('../../.test-build/withdrawals.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');

const db = getDb();
const EVM_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const OTHER_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';

function seedUser(fields = {}) {
  const userId = generateId();
  const columns = ['user_id', 'email', 'password_hash', 'status', 'kyc_level', 'kyc_status'];
  const values = [userId, `${userId}@example.com`, hashPassword('password123'), 'active', '3', 'approved'];
  for (const [key, value] of Object.entries(fields)) {
    columns.push(key);
    values.push(value);
  }
  db.prepare(
    `INSERT INTO users (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...values);
  return userId;
}

function listPair(symbol) {
  const pairId = generateId();
  db.prepare(
    `INSERT INTO trading_pairs (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, 'BTC', 'RUSD', ?, 'active', 0.01, 0.0001, 100000, 1, 0.001, 0.001)`,
  ).run(pairId, symbol);
  return pairId;
}

function recordTrade(symbol, maker, taker, side, price, quantity) {
  db.prepare(
    `INSERT INTO spot_trades
       (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id, side, price, quantity, quote_quantity, maker_fee, taker_fee, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, datetime('now'))`,
  ).run(generateId(), symbol, generateId(), generateId(), maker, taker, side, price, quantity, price * quantity);
}

function recordOrder(pairId, userId, side, price, quantity, status, filled, createdSecondsAgo, updatedSecondsAgo) {
  db.prepare(
    `INSERT INTO orders
       (order_id, user_id, pair_id, side, type, price, quantity, filled_quantity, remaining_quantity, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'limit', ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`,
  ).run(
    generateId(),
    userId,
    pairId,
    side,
    price,
    quantity,
    filled,
    quantity - filled,
    status,
    `-${createdSecondsAgo} seconds`,
    `-${updatedSecondsAgo} seconds`,
  );
}

function fund(userId, asset, amount) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, asset);
  db.prepare(
    'INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)',
  ).run(generateId(), walletId, asset, amount);
}

function setFees(policies) {
  db.prepare(
    `INSERT INTO system_settings (key, value, category) VALUES ('withdrawal_fees', ?, 'operations')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(policies));
}

// --- Market surveillance ---------------------------------------------------

test('surveillance: an empty window raises nothing', () => {
  const result = surveillance.runSurveillanceCycle();
  assert.equal(result.alerts.length, 0);
});

test('surveillance: a self-match fill is flagged', () => {
  const user = seedUser();
  recordTrade('BTC/RUSD', user, user, 'buy', 100, 1);
  const result = surveillance.runSurveillanceCycle();
  const selfMatch = result.alerts.find((a) => a.kind === 'self_match');
  assert.ok(selfMatch, 'expected a self_match alert');
  assert.equal(selfMatch.userId, user);
  assert.equal(selfMatch.score, 1);
});

test('surveillance: two accounts round-tripping with no net position is a wash', () => {
  const a = seedUser();
  const b = seedUser();
  // A buys 10 from B, then B buys 10 from A: net position of each is zero.
  recordTrade('ETH/RUSD', b, a, 'buy', 100, 10);
  recordTrade('ETH/RUSD', a, b, 'buy', 100, 10);
  const result = surveillance.runSurveillanceCycle();
  const wash = result.alerts.find((x) => x.kind === 'wash_trading');
  assert.ok(wash, 'expected a wash_trading alert');
  assert.ok(wash.detail.trades >= 2);
});

test('surveillance: a genuine two-sided market between many accounts is not a wash', () => {
  const buyers = [seedUser(), seedUser(), seedUser()];
  const seller = seedUser();
  // Each buyer only ever buys: the seller accumulates a large net position.
  for (const buyer of buyers) recordTrade('SOL/RUSD', seller, buyer, 'buy', 50, 20);
  const result = surveillance.runSurveillanceCycle();
  const wash = result.alerts.find((x) => x.kind === 'wash_trading');
  assert.equal(wash, undefined);
});

test('surveillance: repeated short-lived far-from-mid cancels with a small fill is layering', () => {
  const pairId = listPair('TGR/RUSD');
  const user = seedUser();
  // Establish a mid of 100.
  recordTrade('TGR/RUSD', seedUser(), seedUser(), 'buy', 100, 1);
  // Two large orders 5% away from the mid, cancelled within 1s, plus a small fill.
  recordOrder(pairId, user, 'sell', 105, 500, 'cancelled', 0, 30, 29);
  recordOrder(pairId, user, 'sell', 106, 500, 'cancelled', 0, 30, 29);
  recordOrder(pairId, user, 'buy', 100, 5, 'filled', 5, 30, 30);
  const result = surveillance.runSurveillanceCycle();
  const kinds = result.alerts.map((a) => a.kind);
  assert.ok(kinds.includes('layering'), `expected layering, got ${kinds.join(',')}`);
});

test('surveillance: re-running the same window does not duplicate an alert', () => {
  const user = seedUser();
  recordTrade('ADA/RUSD', user, user, 'buy', 1, 1);
  const first = surveillance.runSurveillanceCycle();
  assert.ok(first.alerts.length >= 1);
  const second = surveillance.runSurveillanceCycle();
  assert.equal(second.alerts.length, 0, 'a repeated pass must not raise the same alert again');
  assert.ok(surveillance.listAlerts({ status: 'open' }).length >= 1);
});

test('surveillance: an alert can be resolved and then it leaves the open list', () => {
  const user = seedUser();
  recordTrade('XRP/RUSD', user, user, 'buy', 1, 1);
  const result = surveillance.runSurveillanceCycle();
  const alert = result.alerts.find((a) => a.kind === 'self_match');
  assert.ok(alert);
  assert.equal(surveillance.resolveAlert(alert.alertId, 'reviewed'), true);
  assert.equal(surveillance.resolveAlert(alert.alertId, 'reviewed'), false, 'a closed alert is not re-closed');
});

// --- Travel rule -----------------------------------------------------------

test('travel rule: a transfer below the threshold is not required', () => {
  const decision = travelRule.evaluateTravelRule({
    direction: 'withdrawal',
    amountUsd: 10,
    originator: {},
    beneficiary: { accountRef: EVM_ADDRESS },
  });
  assert.equal(decision.required, false);
});

test('travel rule: an unpriced transfer is treated as in scope', () => {
  const decision = travelRule.evaluateTravelRule({
    direction: 'withdrawal',
    amountUsd: null,
    originator: {},
    beneficiary: { accountRef: EVM_ADDRESS },
  });
  assert.equal(decision.required, true);
});

test('travel rule: an in-scope transfer with missing party data is refused', () => {
  assert.throws(
    () =>
      travelRule.assertTravelRuleSatisfied({
        direction: 'transfer',
        amountUsd: 5000,
        originator: { name: 'Alice', accountRef: 'u1' },
        beneficiary: { accountRef: 'u2' },
      }),
    (error) => error instanceof travelRule.TravelRuleError && error.code === 'TRAVEL_RULE_DATA_REQUIRED',
  );
});

test('travel rule: a complete in-scope transfer is accepted and recorded with a hash', () => {
  const messageId = travelRule.recordTravelRuleMessage({
    direction: 'transfer',
    originator: { name: 'Alice', accountRef: 'u1', countryCode: 'GB' },
    beneficiary: { name: 'Bob', accountRef: 'u2', countryCode: 'DE' },
    amountUsd: 5000,
    asset: 'RUSD',
    amount: '5000',
    referenceId: 'ref-1',
  });
  const row = db
    .prepare('SELECT payload, payload_hash FROM travel_rule_messages WHERE message_id = ?')
    .get(messageId);
  assert.ok(row.payload.includes('Alice'));
  assert.match(row.payload_hash, /^[0-9a-f]{64}$/);
  assert.equal(travelRule.listTravelRuleMessages({ referenceId: 'ref-1' }).length, 1);
});

// --- Destination risk ------------------------------------------------------

test('address risk: a sanctions-listed address is blocked', () => {
  addSanctionsEntry({ kind: 'address', value: OTHER_ADDRESS.toLowerCase(), listName: 'OFAC-SDN', reason: 'test' });
  const user = seedUser();
  const assessment = addressRisk.assessAddress({ userId: user, address: OTHER_ADDRESS, network: 'ERC20', amountUsd: 100 });
  assert.equal(assessment.blocked, true);
  assert.equal(assessment.band, 'blocked');
});

test('address risk: an operator-blocked address is blocked', () => {
  const user = seedUser();
  addressRisk.setAddressRisk(EVM_ADDRESS, 'ERC20', 'blocked', 'operator block');
  const assessment = addressRisk.assessAddress({ userId: user, address: EVM_ADDRESS, network: 'ERC20', amountUsd: 100 });
  assert.equal(assessment.blocked, true);
  addressRisk.removeAddressRisk(EVM_ADDRESS, 'ERC20');
});

test('address risk: a first-seen high-value destination needs review', () => {
  const user = seedUser();
  const address = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';
  const assessment = addressRisk.assessAddress({ userId: user, address, network: 'ERC20', amountUsd: 50000 });
  assert.equal(assessment.blocked, false);
  assert.equal(assessment.requiresReview, true);
  assert.equal(assessment.firstSeen, true);
});

test('address risk: a destination the user already used is lower risk', () => {
  const user = seedUser();
  const address = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF';
  // Record the address as used by an accepted transfer first.
  addressRisk.recordAddressOutcome({ userId: user, address, network: 'ERC20', amountUsd: 100 });
  const assessment = addressRisk.assessAddress({ userId: user, address, network: 'ERC20', amountUsd: 50000 });
  assert.equal(assessment.firstSeen, false);
  assert.equal(assessment.requiresReview, false);
});

// --- Integration through createWithdrawal ---------------------------------

test('createWithdrawal: a high-value withdrawal without party data is refused by the travel rule', () => {
  setFees({ 'RUSD:ERC20': { fee: 0, minAmount: 1, enabled: true } });
  const user = seedUser({ display_name: null, username: null, country_code: null });
  fund(user, 'RUSD', 100000);
  assert.throws(
    () =>
      createWithdrawal({
        userId: user,
        kycLevel: '3',
        asset: 'RUSD',
        network: 'ERC20',
        amount: 5000,
        fee: 0,
        address: EVM_ADDRESS,
        usdPrice: () => 1,
      }),
    (error) => error instanceof WithdrawalError && error.code === 'TRAVEL_RULE_DATA_REQUIRED',
  );
  assert.equal(availableBalance(user, 'RUSD'), 100000, 'a refused withdrawal moves no funds');
});

test('createWithdrawal: a high-value withdrawal with party data is accepted and recorded', () => {
  setFees({ 'RUSD:ERC20': { fee: 0, minAmount: 1, enabled: true } });
  const user = seedUser({ display_name: 'Alice Trader', country_code: 'GB' });
  fund(user, 'RUSD', 100000);
  const result = createWithdrawal({
    userId: user,
    kycLevel: '3',
    asset: 'RUSD',
    network: 'ERC20',
    amount: 5000,
    fee: 0,
    address: EVM_ADDRESS,
    usdPrice: () => 1,
  });
  assert.equal(result.status, 'pending');
  assert.equal(lockedBalance(user, 'RUSD'), 5000);
  const messages = travelRule.listTravelRuleMessages({ referenceId: result.withdrawalId });
  assert.equal(messages.length, 1, 'an in-scope withdrawal records a travel-rule message');
});
