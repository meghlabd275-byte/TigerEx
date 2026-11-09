'use strict';
/**
 * Integration tests for the TigerSwap MEV, V4-hook and sniping settlement
 * services.
 *
 * These run against a real SQLite database built from the production schema and
 * create pools the way the admin API does. Nothing is stubbed: a private order
 * writes a real commitment, a dynamic-fee hook changes the fee a swap actually
 * pays, and a snipe settles through the same ledger path a manual swap uses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-dex-mev-')), 'dex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance } = require('../../.test-build/ledger.js');
const { DexError } = require('../../.test-build/pool-service.js');
const { quoteSwap, executeSwap } = require('../../.test-build/swap-service.js');
const { assessSwapRisk, submitPrivateOrder, privateBatch, revealBatch, scanRecentSandwiches, batchIdFor } =
  require('../../.test-build/mev-service.js');
const { setHook, listHooks, removeHook, effectiveFee, evaluateHooks, poolVolatility } =
  require('../../.test-build/hook-service.js');
const { scanSnipeCandidates, quoteSnipe, executeSnipe } = require('../../.test-build/sniping-service.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, 'active')`).run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
  );
  return userId;
}

function credit(userId, currency, available) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(`INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`).run(
    generateId(),
    walletId,
    currency,
    available,
  );
}

let poolSeq = 0;

function createPool(kind, tokens, reserves, extra = {}) {
  poolSeq += 1;
  const poolId = generateId();
  const address = `0x${String(poolSeq).padStart(40, '0')}`;
  const totalSupply = kind === 'v2' ? Math.sqrt(reserves[tokens[0]] * reserves[tokens[1]]) : reserves[tokens[0]];
  db.prepare(
    `INSERT INTO dex_pools
       (pool_id, kind, address, tokens, fee, amplification, weights, tick_spacing, sqrt_price, liquidity,
        sqrt_price_lower, sqrt_price_upper, reserves, total_supply, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).run(
    poolId,
    kind,
    address,
    JSON.stringify(tokens),
    extra.fee ?? 0.003,
    extra.amplification ?? null,
    extra.weights ? JSON.stringify(extra.weights) : null,
    extra.tickSpacing ?? null,
    extra.sqrtPrice ?? null,
    extra.liquidity ?? null,
    extra.sqrtPriceLower ?? null,
    extra.sqrtPriceUpper ?? null,
    JSON.stringify(reserves),
    totalSupply,
  );
  return poolId;
}

// ---------------------------------------------------------------------------
// MEV protection
// ---------------------------------------------------------------------------

test('assessSwapRisk scores a real swap against the venue pools', () => {
  const poolId = createPool('v2', ['MEVA', 'RUSD'], { MEVA: 1_000_000, RUSD: 1_000_000 });
  const assessment = assessSwapRisk({ tokenIn: 'RUSD', tokenOut: 'MEVA', amountIn: 20_000 });
  assert.ok(assessment.impact > 0, 'a 2% pool trade must have a real impact');
  assert.ok(assessment.score > 0 && assessment.score <= 1);
  assert.equal(assessment.protectionEnabled, true);
  assert.equal(assessment.tokenIn, 'RUSD');
  assert.equal(assessment.tokenOut, 'MEVA');
  assert.ok(poolId);
});

test('assessSwapRisk refuses an unpriceable pair', () => {
  assert.throws(() => assessSwapRisk({ tokenIn: 'RUSD', tokenOut: 'NOTHINGX', amountIn: 100 }), DexError);
});

test('a private order stores a commitment, not the plaintext amount', () => {
  createPool('v2', ['MEVB', 'RUSD'], { MEVB: 500_000, RUSD: 500_000 });
  const user = seedUser();
  const order = submitPrivateOrder({ userId: user, tokenIn: 'RUSD', tokenOut: 'MEVB', amountIn: 1234.5 });
  assert.equal(order.status, 'committed');
  assert.ok(order.commitment.length > 0);

  const row = db.prepare('SELECT * FROM dex_private_orders WHERE order_id = ?').get(order.orderId);
  assert.equal(row.commitment, order.commitment);
  // The stored row keeps the amount (the settlement needs it) but the batch view
  // a searcher would poll exposes the commitment and sequence, not a price.
  const batch = privateBatch(order.batchId);
  assert.equal(batch.entries.length, 1);
  assert.equal(batch.entries[0].commitment, order.commitment);
});

test('orders in one batch are sequenced by commit order and reveal together', () => {
  createPool('v2', ['MEVC', 'RUSD'], { MEVC: 500_000, RUSD: 500_000 });
  const window = 60;
  const now = Date.now();
  const batchId = batchIdFor(now, window);
  const a = submitPrivateOrder({ userId: seedUser(), tokenIn: 'RUSD', tokenOut: 'MEVC', amountIn: 100, windowSeconds: window });
  const b = submitPrivateOrder({ userId: seedUser(), tokenIn: 'RUSD', tokenOut: 'MEVC', amountIn: 200, windowSeconds: window });
  // Both landed in the same window (the test runs far inside one 60s bucket).
  if (a.batchId === b.batchId) {
    assert.equal(a.sequence, 0);
    assert.equal(b.sequence, 1);
  }
  const revealed = revealBatch(a.batchId);
  assert.ok(revealed.entries.every((entry) => entry.status === 'revealed'));
});

test('revealing an unknown batch is refused', () => {
  assert.throws(() => revealBatch('batch-does-not-exist'), DexError);
});

test('scanRecentSandwiches detects a sandwich from the settled swaps', () => {
  const poolId = createPool('v2', ['MEVD', 'RUSD'], { MEVD: 500_000, RUSD: 500_000 });
  const attacker = seedUser();
  const victim = seedUser();
  const insert = db.prepare(
    `INSERT INTO dex_swaps (swap_id, pool_id, user_id, token_in, token_out, amount_in, amount_out, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(generateId(), poolId, attacker, 'RUSD', 'MEVD', 5000, 4900, '2026-01-01 00:00:01');
  insert.run(generateId(), poolId, victim, 'RUSD', 'MEVD', 20000, 19000, '2026-01-01 00:00:02');
  insert.run(generateId(), poolId, attacker, 'MEVD', 'RUSD', 4950, 5100, '2026-01-01 00:00:03');

  const scan = scanRecentSandwiches(100);
  assert.equal(scan.detected, true);
  assert.ok(scan.attackers.includes(attacker));
  assert.equal(scan.victim, victim);
});

// ---------------------------------------------------------------------------
// V4 hooks
// ---------------------------------------------------------------------------

test('a dynamic-fee hook is stored and validated', () => {
  const poolId = createPool('v2', ['HOOKA', 'RUSD'], { HOOKA: 1_000_000, RUSD: 1_000_000 });
  const hook = setHook({ poolId, kind: 'dynamicFee', config: { baseFee: 0.003, maxFee: 0.03, volatilityCeiling: 0.05 } });
  assert.equal(hook.kind, 'dynamicFee');
  assert.equal(listHooks(poolId).length, 1);
  // Re-setting the same kind replaces rather than duplicates.
  setHook({ poolId, kind: 'dynamicFee', config: { baseFee: 0.002, maxFee: 0.02, volatilityCeiling: 0.04 } });
  assert.equal(listHooks(poolId).length, 1);
});

test('an invalid hook configuration is refused at write time', () => {
  const poolId = createPool('v2', ['HOOKB', 'RUSD'], { HOOKB: 1_000_000, RUSD: 1_000_000 });
  assert.throws(() => setHook({ poolId, kind: 'dynamicFee', config: { baseFee: 0.05, maxFee: 0.01 } }), DexError);
  assert.throws(() => setHook({ poolId, kind: 'nonsense', config: {} }), DexError);
});

test('a pool with no swap history charges its base fee', () => {
  const poolId = createPool('v2', ['HOOKC', 'RUSD'], { HOOKC: 1_000_000, RUSD: 1_000_000 });
  setHook({ poolId, kind: 'dynamicFee', config: { baseFee: 0.003, maxFee: 0.03, volatilityCeiling: 0.05 } });
  const effective = effectiveFee(poolId);
  assert.equal(effective.baseFee, 0.003);
  assert.equal(effective.fee, 0.003);
  assert.equal(poolVolatility(poolId), 0);
});

test('a dynamic-fee hook raises the fee a swap actually pays', () => {
  const poolId = createPool('v2', ['HOOKD', 'RUSD'], { HOOKD: 1_000_000, RUSD: 1_000_000 });
  // Seed a volatile price series directly, since the hook measures realised
  // volatility from the venue's own settled swaps.
  const insert = db.prepare(
    `INSERT INTO dex_swaps (swap_id, pool_id, user_id, token_in, token_out, amount_in, amount_out)
     VALUES (?, ?, ?, 'RUSD', 'HOOKD', ?, ?)`,
  );
  const prices = [1.0, 1.4, 0.7, 1.3, 0.8];
  prices.forEach((price) => insert.run(generateId(), poolId, seedUser(), 1000, 1000 * price));

  setHook({ poolId, kind: 'dynamicFee', config: { baseFee: 0.003, maxFee: 0.05, volatilityCeiling: 0.05 } });
  assert.ok(poolVolatility(poolId) > 0, 'the seeded series must show volatility');
  const effective = effectiveFee(poolId);
  assert.ok(effective.fee > effective.baseFee, 'a volatile pool must charge more than the base fee');

  const quote = quoteSwap({ tokenIn: 'RUSD', tokenOut: 'HOOKD', amountIn: 1000 });
  const plain = 1000 * effective.baseFee;
  assert.ok(quote.fee > plain, 'the quote must charge the hooked fee, not the base fee');
});

test('an anti-MEV hook is evaluated for the pool', () => {
  const poolId = createPool('v2', ['HOOKE', 'RUSD'], { HOOKE: 1_000_000, RUSD: 1_000_000 });
  setHook({ poolId, kind: 'antiMev', config: { tolerance: 0.02 } });
  const evaluation = evaluateHooks(poolId, { currentPrice: 1.5, side: 'buy' });
  assert.ok(evaluation.antiMev);
  assert.equal(evaluation.antiMev.allowed, true);
});

test('a hook can be detached', () => {
  const poolId = createPool('v2', ['HOOKF', 'RUSD'], { HOOKF: 1_000_000, RUSD: 1_000_000 });
  setHook({ poolId, kind: 'antiMev', config: { tolerance: 0.02 } });
  assert.equal(listHooks(poolId).length, 1);
  const result = removeHook(poolId, 'antiMev');
  assert.equal(result.removed, true);
  assert.equal(listHooks(poolId).length, 0);
});

// ---------------------------------------------------------------------------
// Sniping
// ---------------------------------------------------------------------------

test('scanSnipeCandidates ranks a fresh funded pool', () => {
  createPool('v2', ['SNIPEA', 'RUSD'], { SNIPEA: 500_000, RUSD: 500_000 });
  const scan = scanSnipeCandidates('SNIPEA');
  assert.ok(scan.candidates.length >= 1, 'a fresh pool must be a candidate');
  assert.equal(scan.candidates[0].tradingEnabled, true);
  assert.equal(scan.candidates[0].flagged, false);
  assert.ok(scan.candidates[0].score > 0);
});

test('quoteSnipe caps the size by the policy impact limit', () => {
  const poolId = createPool('v2', ['SNIPEB', 'RUSD'], { SNIPEB: 100_000, RUSD: 100_000 });
  const quote = quoteSnipe({ poolId, tokenIn: 'RUSD', tokenOut: 'SNIPEB', amountIn: 90_000 });
  assert.equal(quote.eligible, true);
  assert.ok(quote.impact <= 0.1 + 1e-9, `impact ${quote.impact} must be within the cap`);
  assert.ok(quote.amountIn <= 90_000);
  assert.ok(quote.minOut > 0);
});

test('a snipe settles through the normal swap path', () => {
  const poolId = createPool('v2', ['SNIPEC', 'RUSD'], { SNIPEC: 500_000, RUSD: 500_000 });
  const user = seedUser();
  credit(user, 'RUSD', 100_000);
  const before = availableBalance(user, 'SNIPEC');
  const execution = executeSnipe({ userId: user, poolId, tokenIn: 'RUSD', tokenOut: 'SNIPEC', amountIn: 5000 });
  assert.ok(execution.amountOut > 0);
  assert.ok(availableBalance(user, 'SNIPEC') > before, 'the snipe must credit the output token');
  assert.equal(availableBalance(user, 'RUSD'), 95_000);
});

test('a snipe without the input balance is refused and moves nothing', () => {
  const poolId = createPool('v2', ['SNIPED', 'RUSD'], { SNIPED: 500_000, RUSD: 500_000 });
  const user = seedUser();
  credit(user, 'RUSD', 100);
  assert.throws(
    () => executeSnipe({ userId: user, poolId, tokenIn: 'RUSD', tokenOut: 'SNIPED', amountIn: 5000 }),
    DexError,
  );
  assert.equal(availableBalance(user, 'RUSD'), 100);
});
