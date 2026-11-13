'use strict';
/**
 * Proof-of-reserves and reconciliation tests against a real database.
 *
 * The Merkle root must commit to every liability and be reproducible, a user's
 * inclusion proof must verify against the published root, a tampered proof must
 * fail, and reconciliation must fail closed when recorded holdings do not cover
 * user liabilities.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-reserves-')), 'reserves.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const {
  buildReservesReport,
  runReconciliation,
  liabilityLeafHash,
  verifyMerkleProof,
} = require('../../.test-build/reserves.js');

const db = getDb();

function seedUserWithBalance(asset, amount, locked = 0) {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, 'active')`).run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
  );
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, status)
     VALUES (?, ?, 'spot', ?, 'TIGEREX', 'active')`,
  ).run(walletId, userId, asset);
  db.prepare(`INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, ?)`).run(
    generateId(),
    walletId,
    asset,
    amount,
    locked,
  );
  return userId;
}

function setTreasury(asset, balance) {
  const existing = db
    .prepare(`SELECT account_id FROM treasury_accounts WHERE asset = ? AND network = 'TIGEREX' AND account_type = 'hot'`)
    .get(asset);
  if (existing) {
    db.prepare(`UPDATE treasury_accounts SET balance = ? WHERE account_id = ?`).run(balance, existing.account_id);
    return;
  }
  db.prepare(
    `INSERT INTO treasury_accounts (account_id, asset, network, account_type, balance)
     VALUES (?, ?, 'TIGEREX', 'hot', ?)`,
  ).run(generateId(), asset, balance);
}

test('the Merkle root is deterministic and stable across runs', () => {
  seedUserWithBalance('BTC', 1.5);
  seedUserWithBalance('ETH', 10);
  const a = buildReservesReport();
  const b = buildReservesReport();
  assert.equal(a.merkleRoot, b.merkleRoot);
  assert.equal(a.leafCount, 2);
});

test('every liability has an inclusion proof that verifies against the root', () => {
  const userId = seedUserWithBalance('SOL', 42);
  const report = buildReservesReport({ includeProofs: true });
  const leaf = liabilityLeafHash(userId, 'SOL', 42);
  const entry = report.proofs.find((p) => p.leafHash === leaf);
  assert.ok(entry, 'the liability must be present in the tree');
  assert.equal(verifyMerkleProof(entry.leafHash, entry.siblings, report.merkleRoot), true);
});

test('a tampered proof or leaf fails verification', () => {
  const userId = seedUserWithBalance('USDT', 100);
  const report = buildReservesReport({ includeProofs: true });
  const leaf = liabilityLeafHash(userId, 'USDT', 100);
  const entry = report.proofs.find((p) => p.leafHash === leaf);

  // A wrong amount produces a different leaf that does not reach the root.
  const tamperedLeaf = liabilityLeafHash(userId, 'USDT', 101);
  assert.equal(verifyMerkleProof(tamperedLeaf, entry.siblings, report.merkleRoot), false);

  // A flipped sibling likewise breaks the path.
  const siblings = entry.siblings.slice();
  siblings[0] = siblings[0].replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
  assert.equal(verifyMerkleProof(entry.leafHash, siblings, report.merkleRoot), false);
});

test('per-asset liabilities aggregate available and locked balances', () => {
  seedUserWithBalance('DOGE', 1000, 250);
  const report = buildReservesReport();
  const doge = report.assets.find((a) => a.asset === 'DOGE');
  assert.equal(doge.totalLiabilities, 1250);
});

test('reconciliation passes only when recorded holdings cover liabilities', () => {
  setTreasury('BTC', 100);
  setTreasury('ETH', 100);
  setTreasury('SOL', 100);
  setTreasury('USDT', 1000);
  setTreasury('DOGE', 2000);
  const result = runReconciliation();
  assert.equal(result.ok, true);
  for (const entry of result.entries) assert.equal(entry.covered, true);
});

test('reconciliation fails closed on a shortfall, never treating it as covered', () => {
  setTreasury('BTC', 0);
  const result = runReconciliation();
  assert.equal(result.ok, false);
  const btc = result.entries.find((e) => e.asset === 'BTC');
  assert.equal(btc.covered, false);
  assert.ok(btc.surplus < 0);
});

test('an asset with liabilities and no recorded holding is a shortfall', () => {
  seedUserWithBalance('XYZNOLISTING', 5);
  const result = runReconciliation();
  const entry = result.entries.find((e) => e.asset === 'XYZNOLISTING');
  assert.equal(entry.recordedAssets, 0);
  assert.equal(entry.covered, false);
});
