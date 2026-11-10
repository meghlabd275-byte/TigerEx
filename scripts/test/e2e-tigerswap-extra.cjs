'use strict';
/**
 * Live end-to-end check for the TigerSwap features added for zap, vaults and
 * liquid staking.
 *
 * It boots the real production Next.js server against a fresh SQLite database,
 * signs in a bootstrap administrator and a registered trader, seeds the trader a
 * balance the way a deposit would, then drives every new route over HTTP and
 * asserts the responses. Nothing is mocked: the server writes to the database
 * and the assertions are on what it wrote.
 *
 * Run from the repository root: `node scripts/test/e2e-tigerswap-extra.cjs`.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..', '..');
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-e2e2-')), 'e2e.db');
const port = 3457;
const base = `http://127.0.0.1:${port}`;

const adminEmail = 'admin@example.com';
const adminPassword = 'bootstrap-admin-password-16';

async function request(method, url, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

/** Fail fast if something already answers on the port, so a foreign server can
 * never be mistaken for the one this script started. */
async function assertPortFree() {
  try {
    await fetch(`${base}/api/dex/pools`);
  } catch {
    return;
  }
  throw new Error(`port ${port} is already in use; refusing to test a foreign server`);
}

async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/dex/pools`);
      if (response.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('the server did not become ready in time');
}

/** Credit a balance directly, the way a confirmed deposit would. */
function creditBalance(userId, currency, amount) {
  const db = new Database(dbPath);
  try {
    const walletId = crypto.randomUUID();
    db.prepare(`INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', ?, 'TIGEREX')`).run(
      walletId,
      userId,
      currency,
    );
    db.prepare(`INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`).run(
      crypto.randomUUID(),
      walletId,
      currency,
      amount,
    );
  } finally {
    db.close();
  }
}

/**
 * Seed an active trader and a live session, the state a completed email
 * verification leaves behind. The session token is what the API reads.
 */
function seedTrader(email) {
  const bcrypt = require('bcryptjs');
  const db = new Database(dbPath);
  try {
    const userId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(
      `INSERT INTO users (user_id, email, password_hash, status, email_verified, kyc_level, kyc_status)
       VALUES (?, ?, ?, 'active', 1, 'level_1', 'approved')`,
    ).run(userId, email.toLowerCase(), bcrypt.hashSync('Str0ng-Password!42', 12));
    db.prepare(
      `INSERT INTO sessions (session_id, user_id, access_token, expires_at)
       VALUES (?, ?, ?, datetime('now', '+1 day'))`,
    ).run(crypto.randomUUID(), userId, token);
    return { userId, token };
  } finally {
    db.close();
  }
}

async function main() {
  await assertPortFree();
  const server = spawn('npm', ['run', 'start', '--', '-p', String(port)], {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      ENCRYPTION_KEY: 'test-encryption-key-0123456789abcdef0123456789',
      TIGEREX_BOOTSTRAP_ADMIN_EMAIL: adminEmail,
      TIGEREX_BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
      TIGEREX_KEEPER_SECRET: 'e2e-keeper-secret-0123456789',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (chunk) => (serverLog += chunk.toString()));
  server.stderr.on('data', (chunk) => (serverLog += chunk.toString()));

  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    await waitForServer();
    assert.ok(fs.existsSync(dbPath), `the server did not create the expected database at ${dbPath}`);

    const adminLogin = await request('POST', '/api/admin/auth/login', {
      body: { email: adminEmail, password: adminPassword },
    });
    assert.equal(adminLogin.status, 200, `admin login failed: ${JSON.stringify(adminLogin.json)}`);
    const adminToken = adminLogin.json.accessToken;
    record('admin login', true);

    // Registration requires a verified email, so the trader is seeded the way a
    // completed verification leaves the account: an active user plus a session.
    const email = `trader-${Date.now()}@example.com`;
    const trader = seedTrader(email);
    const token = trader.token;
    record('trader seeded with an active session', true);

    creditBalance(trader.userId, 'RUSD', 1_000_000);
    creditBalance(trader.userId, 'TGR', 100_000);
    record('trader funded with RUSD and TGR', true);

    // --- Pool -------------------------------------------------------------
    const pool = await request('POST', '/api/admin/dex/pools', {
      token: adminToken,
      body: { kind: 'v2', tokens: ['RUSD', 'TGR'], fee: 0.003, reserves: { RUSD: 1000000, TGR: 100000 } },
    });
    assert.equal(pool.status, 201, `pool create failed: ${JSON.stringify(pool.json)}`);
    const poolId = pool.json.poolId;
    record('admin creates a v2 pool', true, poolId);

    // --- Vault ------------------------------------------------------------
    const vault = await request('POST', '/api/admin/dex/vaults', {
      token: adminToken,
      body: {
        name: `Vault ${Date.now()}`,
        kind: 'lp',
        poolId,
        stakedToken: 'TGR',
        rewardToken: 'RYUSD',
        performanceFeeBps: 1000,
        minHarvest: 0,
      },
    });
    assert.equal(vault.status, 201, `vault create failed: ${JSON.stringify(vault.json)}`);
    const vaultId = vault.json.vaultId;
    record('admin creates a vault', true, vaultId);

    const deposit = await request('POST', '/api/dex/vaults', {
      token,
      body: { vaultId, assets: 1000 },
    });
    assert.equal(deposit.status, 201, `vault deposit failed: ${JSON.stringify(deposit.json)}`);
    assert.equal(deposit.json.deposit.shares, 1000, 'the first deposit must mint one share per asset');
    record('vault deposit mints shares', true);

    const unfundedHarvest = await request('PATCH', '/api/admin/dex/vaults', {
      token: adminToken,
      body: { vaultId, rewardAmount: 100, assetsAdded: 100 },
    });
    assert.equal(unfundedHarvest.status, 409, 'an unfunded harvest must fail closed');
    record('a harvest without a funded reward account is refused', true);

    const fundVault = await request('PATCH', '/api/admin/dex/vaults', {
      token: adminToken,
      body: { vaultId, action: 'fund-rewards', asset: 'TGR', amount: 100 },
    });
    assert.equal(fundVault.status, 201, `vault funding failed: ${JSON.stringify(fundVault.json)}`);
    record('admin funds the vault reward account', true);

    const harvest = await request('PATCH', '/api/admin/dex/vaults', {
      token: adminToken,
      body: { vaultId, rewardAmount: 100, assetsAdded: 100 },
    });
    assert.equal(harvest.status, 200, `harvest failed: ${JSON.stringify(harvest.json)}`);
    assert.equal(harvest.json.harvest.performanceFee, 10, 'a 10% fee on a 100 gain must be 10');
    record('admin harvests the vault', true);

    const positions = await request('GET', '/api/dex/vaults', { token });
    const position = positions.json.positions.find((entry) => entry.vaultId === vaultId);
    assert.ok(position, 'the vault position must be listed');
    assert.ok(position.assets > 1000, `the position must have grown, got ${position.assets}`);
    record('the harvest raised the depositor position', true, `value ${position.assets.toFixed(4)}`);

    const withdraw = await request('DELETE', '/api/dex/vaults', {
      token,
      body: { vaultId, shares: 1000 },
    });
    assert.equal(withdraw.status, 200, `vault withdraw failed: ${JSON.stringify(withdraw.json)}`);
    assert.ok(withdraw.json.withdrawal.assets > 1000, 'the withdrawal must include the harvest');
    record('vault withdrawal returns the grown position', true, `assets ${withdraw.json.withdrawal.assets.toFixed(4)}`);

    // --- Liquid staking ---------------------------------------------------
    const stake = await request('POST', '/api/admin/dex/liquid-staking', {
      token: adminToken,
      body: { name: `stTGR ${Date.now()}`, stakeToken: 'TGR', receiptToken: 'stTGR', redemptionFeeBps: 0 },
    });
    assert.equal(stake.status, 201, `staking pool create failed: ${JSON.stringify(stake.json)}`);
    const stakeId = stake.json.stakeId;
    record('admin creates a liquid-staking pool', true, stakeId);

    const badStake = await request('POST', '/api/admin/dex/liquid-staking', {
      token: adminToken,
      body: { name: `bad ${Date.now()}`, stakeToken: 'TGR', receiptToken: 'TGR' },
    });
    assert.equal(badStake.status, 400, 'a same-token receipt must be refused');
    record('liquid staking refuses a same-token receipt', true);

    const earlyRewards = await request('PATCH', '/api/admin/dex/liquid-staking', {
      token: adminToken,
      body: { stakeId, rewards: 50 },
    });
    assert.equal(earlyRewards.status, 409, `expected a no-shares refusal, got ${earlyRewards.status}`);
    record('rewards are refused while no stTGR is outstanding', true);

    const staked = await request('POST', '/api/dex/liquid-staking', {
      token,
      body: { stakeId, amount: 1000 },
    });
    assert.equal(staked.status, 201, `stake failed: ${JSON.stringify(staked.json)}`);
    assert.equal(staked.json.stake.shares, 1000, 'the first stake must mint one share per token');
    record('trader stakes TGR for stTGR', true);

    const fundRewards = await request('PATCH', '/api/admin/dex/liquid-staking', {
      token: adminToken,
      body: { action: 'fund-rewards', stakeToken: 'TGR', amount: 100 },
    });
    assert.equal(fundRewards.status, 201, `reward funding failed: ${JSON.stringify(fundRewards.json)}`);
    record('admin funds the liquid-staking reward account', true);

    const rewards = await request('PATCH', '/api/admin/dex/liquid-staking', {
      token: adminToken,
      body: { stakeId, rewards: 100 },
    });
    assert.equal(rewards.status, 200, `reward distribution failed: ${JSON.stringify(rewards.json)}`);
    assert.ok(Math.abs(rewards.json.distribution.rate - 1.1) < 1e-9, 'a 10% reward must move the rate to 1.1');
    record('rewards raise the exchange rate to 1.1', true);

    const unstake = await request('DELETE', '/api/dex/liquid-staking', {
      token,
      body: { stakeId, shares: 1000 },
    });
    assert.equal(unstake.status, 200, `unstake failed: ${JSON.stringify(unstake.json)}`);
    assert.ok(Math.abs(unstake.json.unstake.received - 1100) < 1e-6, `expected 1100 TGR back, got ${unstake.json.unstake.received}`);
    record('unstaking returns the staked amount plus rewards', true);

    // --- Zap --------------------------------------------------------------
    const zap = await request('POST', '/api/dex/zap', {
      token,
      body: { poolId, tokenIn: 'RUSD', amountIn: 10_000, slippage: 0.01 },
    });
    assert.equal(zap.status, 201, `zap failed: ${JSON.stringify(zap.json)}`);
    assert.ok(zap.json.zap.liquidity > 0, 'the zap must mint liquidity');
    assert.ok(zap.json.zap.swappedOut > 0, 'the zap must swap one leg');
    record('zap deposits a single token into both sides', true, `liquidity ${zap.json.zap.liquidity.toFixed(4)}`);

    const zapOut = await request('DELETE', '/api/dex/zap', {
      token,
      body: { poolId, liquidity: zap.json.zap.liquidity, tokenOut: 'RUSD', slippage: 0.05 },
    });
    assert.equal(zapOut.status, 200, `zap-out failed: ${JSON.stringify(zapOut.json)}`);
    assert.ok(zapOut.json.zap.received > 0, 'the zap-out must return a single token');
    record('zap-out redeems a position into one token', true, `received ${zapOut.json.zap.received.toFixed(4)} RUSD`);

    // --- LP analytics -----------------------------------------------------
    // A swap has settled against the pool, so the pool's 24-hour fee run rate is
    // non-zero and the analytics must reflect it rather than a placeholder.
    const analyticsSwap = await request('POST', '/api/dex/swap', {
      token,
      body: { tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 5_000, slippage: 0.02 },
    });
    assert.equal(analyticsSwap.status, 201, `analytics swap failed: ${JSON.stringify(analyticsSwap.json)}`);

    // The pool holds TGR, so until TGR has a mark the pool cannot be valued and
    // must report no rate rather than a zero that would read as "earns nothing".
    const poolsAfter = await request('GET', '/api/dex/pools');
    const poolRow = poolsAfter.json.pools.find((entry) => entry.poolId === poolId);
    assert.ok(poolRow, 'the pool must be listed');
    assert.equal(poolRow.feeApr, null, 'an unpriceable pool reports no rate rather than a zero');

    // Seed the TGR mark the way the oracle does, then trade once more so the
    // pool's value and its fee counters are recomputed against the real price.
    const priceDb = new Database(dbPath);
    try {
      priceDb
        .prepare("INSERT INTO market_data (id, symbol, price, volume_24h) VALUES (?, ?, ?, 0)")
        .run(crypto.randomUUID(), 'TGR/RUSD', 2);
    } finally {
      priceDb.close();
    }
    const pricedSwap = await request('POST', '/api/dex/swap', {
      token,
      body: { tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1_000, slippage: 0.02 },
    });
    assert.equal(pricedSwap.status, 201, `priced swap failed: ${JSON.stringify(pricedSwap.json)}`);

    const priced = await request('GET', '/api/dex/pools');
    const pricedPool = priced.json.pools.find((entry) => entry.poolId === poolId);
    assert.ok(pricedPool.tvlUsd > 0, 'a priceable pool must carry a real value');
    assert.ok(Number.isFinite(pricedPool.feeApr), 'a priceable pool must report a numeric fee APR');
    assert.ok(Number.isFinite(pricedPool.feeApy), 'a priceable pool must report a numeric fee APY');
    assert.ok(pricedPool.feeApr > 0, `a pool with settled volume must earn a rate, got ${pricedPool.feeApr}`);
    assert.ok(pricedPool.feeApy > pricedPool.feeApr, 'the APY must compound the APR');
    record('the pools endpoint reports a live fee APR and APY', true, `apr ${(pricedPool.feeApr * 100).toFixed(2)}%`);

    // Open a fresh position: the zap-out above closed the earlier one.
    const lpAdd = await request('POST', '/api/dex/liquidity', {
      token,
      body: { poolId, amounts: { RUSD: 20_000, TGR: 10_000 } },
    });
    assert.equal(lpAdd.status, 201, `liquidity add failed: ${JSON.stringify(lpAdd.json)}`);
    assert.ok(lpAdd.json.position.liquidity > 0, 'the deposit must mint liquidity');

    const lpPositions = await request('GET', '/api/dex/liquidity', { token });
    assert.equal(lpPositions.status, 200, `liquidity list failed: ${JSON.stringify(lpPositions.json)}`);
    const lp = lpPositions.json.positions.find((entry) => entry.poolId === poolId);
    assert.ok(lp, 'the provider position must be listed');
    assert.ok(Number.isFinite(lp.valueUsd) && lp.valueUsd > 0, 'the position must carry a real value');
    assert.ok(Number.isFinite(lp.feeApr) && lp.feeApr > 0, 'the position must carry the pool fee rate');
    assert.ok(lp.divergenceLoss === null || lp.divergenceLoss <= 0, 'divergence loss is never positive');
    record('the position reports value, fee rate and divergence loss', true, `value ${lp.valueUsd.toFixed(2)}`);

    // --- veTGR farm boost --------------------------------------------------
    // A boosted farm splits a fixed emission by veTGR-weighted stake, so a
    // holder with veTGR earns more of the same emission than a plain staker.
    const boostedFarm = await request('POST', '/api/admin/dex/farms', {
      token: adminToken,
      body: { name: `Boosted ${Date.now()}`, poolId, rewardToken: 'RUSD', rewardRate: 1, boostMultiplier: 2.5, vetgr: true },
    });
    assert.equal(boostedFarm.status, 201, `boosted farm failed: ${JSON.stringify(boostedFarm.json)}`);
    const boostedFarmId = boostedFarm.json.farmId;

    // A boosted farm must not promise a boost above the published ceiling.
    const overBoost = await request('POST', '/api/admin/dex/farms', {
      token: adminToken,
      body: { name: `Overboost ${Date.now()}`, poolId, rewardToken: 'RUSD', rewardRate: 1, boostMultiplier: 5, vetgr: true },
    });
    assert.equal(overBoost.status, 400, 'a veTGR farm must reject a boost above 2.5x');

    await request('POST', '/api/admin/dex/farms', {
      token: adminToken,
      body: { action: 'fund-rewards', asset: 'RUSD', amount: 100_000 },
    });

    // The trader locks TGR for the maximum term, which is full voting power.
    const lock = await request('POST', '/api/dex/veTGR', { token, body: { amount: 10_000, lockDays: 1460 } });
    assert.equal(lock.status, 201, `veTGR lock failed: ${JSON.stringify(lock.json)}`);
    assert.ok(lock.json.lock.votingPower > 0, 'a lock must carry voting power');

    const held = await request('GET', '/api/dex/liquidity', { token });
    assert.equal(held.status, 200, `liquidity read failed: ${JSON.stringify(held.json)}`);
    const heldPosition = held.json.positions.find((entry) => entry.poolId === poolId);
    assert.ok(heldPosition && heldPosition.liquidity > 0, 'the provider must hold LP tokens to stake');
    const lpAmount = heldPosition.liquidity;

    const farmStake = await request('POST', '/api/dex/farms', { token, body: { action: 'stake', farmId: boostedFarmId, amount: lpAmount } });
    assert.equal(farmStake.status, 201, `farm stake failed: ${JSON.stringify(farmStake.json)}`);

    const boostView = await request('GET', '/api/dex/farms', { token });
    assert.equal(boostView.status, 200, `farm view failed: ${JSON.stringify(boostView.json)}`);
    const boostedPosition = boostView.json.positions.find((entry) => entry.farmId === boostedFarmId);
    assert.ok(boostedPosition, 'the staked position must be listed');
    assert.ok(boostedPosition.weight > boostedPosition.staked, 'veTGR must raise the position weight above the raw stake');
    assert.ok(boostedPosition.boost > 1, 'the reported boost must exceed 1x');
    record('veTGR boosts a farm position above its raw stake', true, `weight ${boostedPosition.weight.toFixed(2)} vs stake ${boostedPosition.staked.toFixed(2)}`);

    // --- MEV protection ---------------------------------------------------
    const assessment = await request('GET', '/api/dex/mev?tokenIn=RUSD&tokenOut=TGR&amountIn=1000', { token });
    assert.equal(assessment.status, 200, `mev assess failed: ${JSON.stringify(assessment.json)}`);
    assert.ok(assessment.json.assessment.impact >= 0, 'the assessment must carry a real impact');
    assert.equal(assessment.json.assessment.protectionEnabled, true);
    record('MEV assessment scores a real swap', true, `impact ${assessment.json.assessment.impact.toFixed(6)}`);

    const privateOrder = await request('POST', '/api/dex/mev', {
      token,
      body: { tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 1000 },
    });
    assert.equal(privateOrder.status, 201, `private order failed: ${JSON.stringify(privateOrder.json)}`);
    assert.ok(privateOrder.json.order.commitment.length > 0, 'the order must carry a commitment');
    record('a swap enters the private order path', true, privateOrder.json.order.commitment);

    const reveal = await request('PUT', '/api/dex/mev', {
      token,
      body: { batchId: privateOrder.json.order.batchId, action: 'reveal' },
    });
    assert.equal(reveal.status, 200, `reveal failed: ${JSON.stringify(reveal.json)}`);
    assert.ok(reveal.json.batch.entries.length >= 1, 'the batch must expose its entries');
    record('the private batch reveals in commit order', true);

    // The batch settles through the same swap path the public flow uses, and a
    // settled batch must not be replayable: re-revealing or re-settling it would
    // trade the same order twice.
    const portfolioBefore = await request('GET', '/api/dex/portfolio', { token });
    assert.equal(portfolioBefore.status, 200, `portfolio read failed: ${JSON.stringify(portfolioBefore.json)}`);
    const rusdBefore = portfolioBefore.json.holdings.find((h) => h.currency === 'RUSD')?.available ?? 0;

    const settlement = await request('PUT', '/api/dex/mev', {
      token,
      body: { batchId: privateOrder.json.order.batchId, action: 'settle' },
    });
    assert.equal(settlement.status, 200, `settle failed: ${JSON.stringify(settlement.json)}`);
    assert.equal(settlement.json.settlement.settled, 1, 'the committed order must settle');
    assert.equal(settlement.json.settlement.failed, 0);

    const portfolioAfter = await request('GET', '/api/dex/portfolio', { token });
    const rusdAfter = portfolioAfter.json.holdings.find((h) => h.currency === 'RUSD')?.available ?? 0;
    assert.ok(rusdAfter < rusdBefore, 'settling a private order must spend the input token');

    const replay = await request('PUT', '/api/dex/mev', {
      token,
      body: { batchId: privateOrder.json.order.batchId, action: 'settle' },
    });
    assert.equal(replay.status, 409, 'a settled batch must not settle twice');
    record('a private batch settles once and cannot be replayed', true, `spent ${(rusdBefore - rusdAfter).toFixed(2)} RUSD`);

    const sandwich = await request('GET', '/api/dex/mev?scan=sandwich', { token });
    assert.equal(sandwich.status, 200, `sandwich scan failed: ${JSON.stringify(sandwich.json)}`);
    assert.equal(typeof sandwich.json.scan.detected, 'boolean');
    record('the sandwich scan reads the settled swaps', true, `${sandwich.json.scan.observations} swaps`);

    // --- V4 hooks ---------------------------------------------------------
    const hook = await request('POST', '/api/admin/dex/hooks', {
      token: adminToken,
      body: { poolId, kind: 'dynamicFee', config: { baseFee: 0.003, maxFee: 0.03, volatilityCeiling: 0.05 } },
    });
    assert.equal(hook.status, 201, `hook attach failed: ${JSON.stringify(hook.json)}`);
    record('admin attaches a dynamic-fee hook', true, hook.json.hook.kind);

    const badHook = await request('POST', '/api/admin/dex/hooks', {
      token: adminToken,
      body: { poolId, kind: 'dynamicFee', config: { baseFee: 0.05, maxFee: 0.01 } },
    });
    assert.equal(badHook.status, 400, `a hook whose max fee is below its base must be refused, got ${badHook.status}`);
    record('a hook with an invalid configuration is refused', true);

    const evaluation = await request('GET', `/api/dex/hooks?poolId=${poolId}&evaluate=true`, { token });
    assert.equal(evaluation.status, 200, `hook evaluation failed: ${JSON.stringify(evaluation.json)}`);
    assert.ok(evaluation.json.evaluation.fee >= evaluation.json.evaluation.baseFee, 'the hooked fee must not fall below the base');
    record('the hook evaluation reports the effective fee', true, `fee ${evaluation.json.evaluation.fee}`);

    const hookDetach = await request('DELETE', `/api/admin/dex/hooks?poolId=${poolId}&kind=dynamicFee`, { token: adminToken });
    assert.equal(hookDetach.status, 200, `hook detach failed: ${JSON.stringify(hookDetach.json)}`);
    assert.equal(hookDetach.json.removed, true);
    record('admin detaches the hook', true);

    // --- Anti-MEV enforcement --------------------------------------------
    // The anti-MEV hook used to be stored and "evaluated" without ever gating a
    // swap. This drives the real path: pin the settlement block, attach the hook
    // to a fresh pool, push the pool's price with one swap, then confirm the next
    // swap on the same pool is refused over HTTP.
    const blockPin = await request('PUT', '/api/admin/settings', {
      token: adminToken,
      body: { key: 'dex_block_seconds', value: '86400' },
    });
    assert.equal(blockPin.status, 200, `block pin failed: ${JSON.stringify(blockPin.json)}`);

    const mevPool = await request('POST', '/api/admin/dex/pools', {
      token: adminToken,
      body: { kind: 'v2', tokens: ['MEVA', 'RUSD'], fee: 0.003, reserves: { MEVA: 1000000, RUSD: 1000000 } },
    });
    assert.equal(mevPool.status, 201, `anti-MEV pool create failed: ${JSON.stringify(mevPool.json)}`);
    const mevPoolId = mevPool.json.poolId;

    const mevHook = await request('POST', '/api/admin/dex/hooks', {
      token: adminToken,
      body: { poolId: mevPoolId, kind: 'antiMev', config: { tolerance: 0.02 } },
    });
    assert.equal(mevHook.status, 201, `anti-MEV hook attach failed: ${JSON.stringify(mevHook.json)}`);
    record('admin attaches an anti-MEV hook', true, mevHook.json.hook.kind);

    creditBalance(trader.userId, 'RUSD', 1_000_000);
    // The first swap of the block records the open price and pushes the pool up.
    const frontRun = await request('POST', '/api/dex/swap', {
      token,
      body: { tokenIn: 'RUSD', tokenOut: 'MEVA', amountIn: 50_000, slippage: 0.05 },
    });
    assert.equal(frontRun.status, 201, `the front-run swap failed: ${JSON.stringify(frontRun.json)}`);

    // The next swap on the same pool is refused because the price was pushed
    // against it in the same block.
    const pushed = await request('POST', '/api/dex/swap', {
      token,
      body: { tokenIn: 'RUSD', tokenOut: 'MEVA', amountIn: 10_000, slippage: 0.05 },
    });
    assert.equal(pushed.status, 409, `a swap after a same-block price push must be refused, got ${pushed.status}`);
    assert.equal(pushed.json.error.code, 'MEV_PROTECTED');
    record('the anti-MEV hook refuses a swap after a same-block push', true);

    // Detach so the hook cannot colour a later check.
    await request('DELETE', `/api/admin/dex/hooks?poolId=${mevPoolId}&kind=antiMev`, { token: adminToken });

    // --- Sniping ----------------------------------------------------------
    const snipeScan = await request('GET', '/api/dex/sniping?tokenIn=TGR', { token });
    assert.equal(snipeScan.status, 200, `snipe scan failed: ${JSON.stringify(snipeScan.json)}`);
    assert.ok(Array.isArray(snipeScan.json.scan.candidates));
    record('the sniping scan lists eligible pools', true, `${snipeScan.json.scan.candidates.length} candidates`);

    if (snipeScan.json.scan.candidates.length > 0) {
      const snipeQuote = await request(
        'GET',
        `/api/dex/sniping?poolId=${poolId}&tokenIn=RUSD&tokenOut=TGR&amountIn=5000`,
        { token },
      );
      assert.equal(snipeQuote.status, 200, `snipe quote failed: ${JSON.stringify(snipeQuote.json)}`);
      assert.ok(snipeQuote.json.quote.impact <= snipeScan.json.scan.policy.maxImpact + 1e-9);
      record('the snipe quote caps its size by the impact limit', true);

      const snipe = await request('POST', '/api/dex/sniping', {
        token,
        body: { poolId, tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 5000 },
      });
      assert.equal(snipe.status, 201, `snipe failed: ${JSON.stringify(snipe.json)}`);
      assert.ok(snipe.json.snipe.amountOut > 0, 'the snipe must return an output');
      record('a snipe settles through the normal swap path', true, `out ${snipe.json.snipe.amountOut.toFixed(4)}`);
    }

    // --- Bots -------------------------------------------------------------
    const botCreate = await request('POST', '/api/dex/bots', {
      token,
      body: {
        action: 'create',
        botType: 'grid',
        poolId,
        params: { lowerPrice: 1, upperPrice: 100, levels: 5, orderSize: 10, tokenIn: 'RUSD', tokenOut: 'TGR' },
      },
    });
    assert.equal(botCreate.status, 201, `bot create failed: ${JSON.stringify(botCreate.json)}`);
    const botInstanceId = botCreate.json.instance.instanceId;
    record('a bot instance is created', true, botCreate.json.instance.botType);

    const badBot = await request('POST', '/api/dex/bots', {
      token,
      body: { action: 'create', botType: 'grid', params: { lowerPrice: 100, upperPrice: 1, levels: 5, orderSize: 10 } },
    });
    assert.equal(badBot.status, 400, `an inverted grid must be refused, got ${badBot.status}`);
    record('a bot with an invalid plan is refused', true);

    const botList = await request('GET', '/api/dex/bots', { token });
    assert.equal(botList.status, 200, `bot list failed: ${JSON.stringify(botList.json)}`);
    assert.ok(botList.json.instances.some((i) => i.instanceId === botInstanceId), 'the new bot must be listed');
    assert.ok(Array.isArray(botList.json.opportunities), 'the arbitrage scan must be present');
    assert.ok(Array.isArray(botList.json.liquidations), 'the liquidation scan must be present');
    record('the bots view lists instances and venue opportunities', true);

    const botEval = await request('POST', '/api/dex/bots', {
      token,
      body: { action: 'evaluate', instanceId: botInstanceId },
    });
    assert.equal(botEval.status, 200, `bot evaluate failed: ${JSON.stringify(botEval.json)}`);
    assert.ok(botEval.json.decision.action, 'the evaluation must report an action');
    record('a bot instance evaluates against live state', true, botEval.json.decision.action);

    const botRun = await request('POST', '/api/dex/bots', {
      token,
      body: { action: 'run', instanceId: botInstanceId },
    });
    assert.equal(botRun.status, 201, `bot run failed: ${JSON.stringify(botRun.json)}`);
    assert.ok(botRun.json.result.action, 'a run must report an action');
    record('a bot instance runs one step', true, botRun.json.result.action);

    // A TWAP instance settles one slice per step, so the CEX-bot parity holds
    // for the DEX too: the parent order is worked over time, not in one trade.
    const twapCreate = await request('POST', '/api/dex/bots', {
      token,
      body: {
        action: 'create',
        botType: 'twap',
        poolId,
        params: { totalQuantity: 30, slices: 3, intervalSeconds: 60, tokenIn: 'RUSD', tokenOut: 'TGR' },
      },
    });
    assert.equal(twapCreate.status, 201, `twap create failed: ${JSON.stringify(twapCreate.json)}`);
    const twapId = twapCreate.json.instance.instanceId;
    const twapRun = await request('POST', '/api/dex/bots', {
      token,
      body: { action: 'run', instanceId: twapId },
    });
    assert.equal(twapRun.status, 201, `twap run failed: ${JSON.stringify(twapRun.json)}`);
    assert.equal(twapRun.json.result.action, 'twap', 'a TWAP step must work one slice');
    assert.equal(twapRun.json.result.executed, true, 'a TWAP slice must settle a real swap');
    assert.ok(twapRun.json.result.swapId, 'a TWAP slice is a real swap');
    record('a TWAP bot works one slice per step', true, `slice size ${twapRun.json.result.amountIn}`);

    const adminBots = await request('GET', '/api/admin/dex/bots', { token: adminToken });
    assert.equal(adminBots.status, 200, `admin bots failed: ${JSON.stringify(adminBots.json)}`);
    assert.ok(adminBots.json.instances.some((i) => i.instanceId === botInstanceId), 'the admin view must see the bot');
    record('admin sees every bot instance', true, `${adminBots.json.instances.length} instances`);

    const botPause = await request('POST', '/api/dex/bots', {
      token,
      body: { action: 'status', instanceId: botInstanceId, status: 'paused' },
    });
    assert.equal(botPause.status, 200, `bot pause failed: ${JSON.stringify(botPause.json)}`);
    assert.equal(botPause.json.instance.status, 'paused');
    record('a bot instance is paused', true);

    const botDelete = await request('POST', '/api/dex/bots', {
      token,
      body: { action: 'delete', instanceId: botInstanceId },
    });
    assert.equal(botDelete.status, 200, `bot delete failed: ${JSON.stringify(botDelete.json)}`);
    assert.equal(botDelete.json.removed, true);
    record('a bot instance is removed', true);

    // --- Perpetual conditional orders ------------------------------------
    // A perpetual market is listed by the admin, a trader opens a position and
    // protects it with a stop-loss. The stop is not client-driven: it is fired
    // by the keeper, so the check drives the keeper secret rather than trusting
    // the trader to settle their own stop.
    const perpSymbol = `BTC${Date.now() % 100000}/RUSD`;
    const perpMarket = await request('POST', '/api/admin/futures/markets', {
      token: adminToken,
      body: {
        symbol: perpSymbol,
        settlementAsset: 'RUSD',
        contractType: 'RUSD_M',
        listingType: 'perpetual',
        contractSize: 1,
        tickSize: 1,
        pricePrecision: 2,
        quantityPrecision: 3,
        minQuantity: 0.001,
        maxQuantity: 1000,
        maxLeverage: 50,
        makerFeeBps: 2,
        takerFeeBps: 5,
        maintenanceMarginRate: 0.005,
        initialMarginRate: 0.008,
        status: 'active',
      },
    });
    assert.equal(perpMarket.status, 201, `perp listing failed: ${JSON.stringify(perpMarket.json)}`);
    // Seed the mark the way the oracle does, so the position opens at a known price.
    const markDb = new Database(dbPath);
    try {
      markDb
        .prepare("INSERT INTO market_data (id, symbol, price, volume_24h) VALUES (?, ?, ?, 0)")
        .run(crypto.randomUUID(), perpSymbol, 50000);
    } finally {
      markDb.close();
    }
    record('admin lists a perpetual market for the DEX', true, perpSymbol);

    const perpOpen = await request('POST', '/api/dex/perps', {
      token,
      body: { symbol: perpSymbol, side: 'long', size: 1, leverage: 10 },
    });
    assert.equal(perpOpen.status, 201, `perp open failed: ${JSON.stringify(perpOpen.json)}`);
    const perpPositionId = perpOpen.json.position.positionId;

    const badStop = await request('POST', '/api/dex/conditional-orders', {
      token,
      body: { positionId: perpPositionId, type: 'stop_loss', quantity: 1, stopPrice: 51000 },
    });
    assert.equal(badStop.status, 400, `a stop above a long's mark must be refused, got ${badStop.status}`);

    const stop = await request('POST', '/api/dex/conditional-orders', {
      token,
      body: { positionId: perpPositionId, type: 'stop_loss', quantity: 1, stopPrice: 49000 },
    });
    assert.equal(stop.status, 201, `stop placement failed: ${JSON.stringify(stop.json)}`);
    assert.equal(stop.json.order.side, 'sell', 'a long is protected by a sell');
    assert.equal(stop.json.order.status, 'pending');

    const listBefore = await request('GET', '/api/dex/perps', { token });
    assert.ok(
      listBefore.json.conditionalOrders.some((o) => o.orderId === stop.json.order.orderId),
      'the perps view must list the conditional order',
    );

    // Move the mark through the stop, then run the keeper: the stop fires and
    // the position closes with real fund movement.
    const stopDb = new Database(dbPath);
    try {
      stopDb.prepare('UPDATE market_data SET price = ? WHERE symbol = ?').run(48000, perpSymbol);
    } finally {
      stopDb.close();
    }
    const keeperSecret = 'e2e-keeper-secret-0123456789';
    const wrongSecret = await fetch(`${base}/api/dex/keeper`, {
      method: 'POST',
      headers: { 'x-keeper-secret': 'not-the-secret' },
    });
    assert.equal(wrongSecret.status, 401, 'the keeper must refuse a wrong secret');
    const keeperRun = await fetch(`${base}/api/dex/keeper`, {
      method: 'POST',
      headers: { 'x-keeper-secret': keeperSecret },
    });
    assert.equal(keeperRun.status, 200, `keeper run failed: ${keeperRun.status}`);
    const keeperReport = (await keeperRun.json()).report;
    assert.equal(keeperReport.conditionalOrdersTriggered, 1, 'the stop must fire exactly once');
    record('a conditional stop is refused above the mark, placed below it, and fired by the keeper', true);

    const afterTrigger = await request('GET', '/api/dex/perps', { token });
    assert.equal(afterTrigger.json.positions.length, 0, 'the stop must close the position');
    assert.equal(
      afterTrigger.json.conditionalOrders.find((o) => o.orderId === stop.json.order.orderId).status,
      'triggered',
    );
    record('the fired stop closed the position and released its margin', true);

    // --- Options AMM ------------------------------------------------------
    // The admin creates a collateral pool for an underlying, funds it from the
    // treasury, and a trader buys a call. The pool reserves the worst-case
    // payout, so a trade it cannot back must be refused, and settlement pays the
    // intrinsic value out of the reserved collateral.
    const optUnderlying = `OPTCO${Date.now() % 100000}`;
    const optDb = new Database(dbPath);
    try {
      optDb
        .prepare("INSERT INTO market_data (id, symbol, price, volume_24h) VALUES (?, ?, ?, 0)")
        .run(crypto.randomUUID(), `${optUnderlying}/RUSD`, 100);
    } finally {
      optDb.close();
    }
    const optPool = await request('POST', '/api/admin/dex/options', {
      token: adminToken,
      body: { underlying: optUnderlying, settlementAsset: 'RUSD', volatility: 0.5, feeBps: 50 },
    });
    assert.equal(optPool.status, 201, `option pool create failed: ${JSON.stringify(optPool.json)}`);
    const optPoolId = optPool.json.pool.poolId;
    record('admin creates an options pool', true, optPoolId);

    const optFund = await request('PUT', '/api/admin/dex/options', {
      token: adminToken,
      body: { poolId: optPoolId, amount: 1000 },
    });
    assert.equal(optFund.status, 200, `option pool funding failed: ${JSON.stringify(optFund.json)}`);
    assert.equal(optFund.json.pool.collateral, 1000, 'the treasury collateral must land in the pool');
    record('admin funds the options pool', true);

    const optBuy = await request('POST', '/api/dex/options', {
      token,
      body: { poolId: optPoolId, type: 'call', strike: 100, capPrice: 150, quantity: 1 },
    });
    assert.equal(optBuy.status, 201, `option buy failed: ${JSON.stringify(optBuy.json)}`);
    const optPositionId = optBuy.json.option.positionId;
    assert.ok(optBuy.json.option.premium > 0, 'the premium must be a real model price');
    assert.equal(optBuy.json.option.reserved, 50, 'a call capped at 150 over a 100 strike reserves 50');
    record('a trader buys a call and the pool reserves the cap', true, `premium ${optBuy.json.option.premium.toFixed(4)}`);

    // A put over a 100 strike reserves the full strike per contract. The pool
    // holds about 956 of free collateral, so a 100-lot put (a 10,000 reserve)
    // must be refused.
    const optRefused = await request('POST', '/api/dex/options', {
      token,
      body: { poolId: optPoolId, type: 'put', strike: 100, quantity: 100 },
    });
    assert.equal(optRefused.status, 400, `an unreservable write must be refused, got ${optRefused.status}`);
    record('the pool refuses a write it cannot back', true);

    // Move the spot up so the call finishes in the money, then settle.
    const settleDb = new Database(dbPath);
    try {
      settleDb.prepare('UPDATE market_data SET price = ? WHERE symbol = ?').run(130, `${optUnderlying}/RUSD`);
    } finally {
      settleDb.close();
    }
    const optSettle = await request('DELETE', '/api/dex/options', {
      token,
      body: { positionId: optPositionId },
    });
    assert.equal(optSettle.status, 200, `option settle failed: ${JSON.stringify(optSettle.json)}`);
    assert.ok(Math.abs(optSettle.json.settlement.payout - 30) < 1e-6, 'a 130 spot over a 100 strike pays 30');
    record('a call settles at its intrinsic value', true, `payout ${optSettle.json.settlement.payout}`);

    const optAfter = await request('GET', '/api/dex/options', { token });
    const settled = optAfter.json.positions.find((p) => p.positionId === optPositionId);
    assert.equal(settled.status, 'settled', 'the position must be settled');
    assert.equal(optAfter.json.pools.find((p) => p.poolId === optPoolId).reserved, 0, 'the reservation must be released');
    record('settlement released the unused reserve', true);

    // A short-dated option is left open until it matures, then the keeper
    // settles it without a user action and releases its reservation.
    const optExpiry = await request('POST', '/api/dex/options', {
      token,
      body: {
        poolId: optPoolId,
        type: 'call',
        strike: 100,
        capPrice: 150,
        quantity: 1,
        expiry: new Date(Date.now() + 3_000).toISOString(),
      },
    });
    assert.equal(optExpiry.status, 201, `short-dated buy failed: ${JSON.stringify(optExpiry.json)}`);
    const keeperNow = await fetch(`${base}/api/dex/keeper`, {
      method: 'POST',
      headers: { 'x-keeper-secret': keeperSecret },
    });
    assert.equal(keeperNow.status, 200, 'the keeper run failed');
    assert.equal((await keeperNow.json()).report.optionsSettled, 0, 'an unexpired option must not settle');
    record('the keeper leaves an unexpired option open', true);

    await new Promise((resolve) => setTimeout(resolve, 3_200));
    const keeperMatured = await fetch(`${base}/api/dex/keeper`, {
      method: 'POST',
      headers: { 'x-keeper-secret': keeperSecret },
    });
    assert.equal(keeperMatured.status, 200, 'the keeper run failed');
    assert.equal((await keeperMatured.json()).report.optionsSettled, 1, 'the matured option must settle');
    const maturedAfter = await request('GET', '/api/dex/options', { token });
    assert.equal(
      maturedAfter.json.positions.find((p) => p.positionId === optExpiry.json.option.positionId).status,
      'settled',
      'the keeper must settle the matured option',
    );
    record('the keeper settles a matured option and releases its reserve', true);

    // --- Emergency controls ----------------------------------------------
    // A blacklisted token is refused by the swap path even while a pool holds
    // it, and a blacklisted wallet cannot swap at all.
    const blockedSwap = await request('POST', '/api/dex/swap', {
      token,
      body: { tokenIn: 'TGR', tokenOut: 'RUSD', amountIn: 10 },
    });
    assert.equal(blockedSwap.status, 201, `the control swap failed: ${JSON.stringify(blockedSwap.json)}`);
    record('a swap settles before the blacklist is applied', true, blockedSwap.json.swap.tokenOut);

    const block = await request('POST', '/api/admin/dex/risk', {
      token: adminToken,
      body: { action: 'blacklist', kind: 'token', value: 'TGR', reason: 'e2e check' },
    });
    assert.equal(block.status, 201, `blacklist failed: ${JSON.stringify(block.json)}`);
    const blockedAgain = await request('POST', '/api/dex/swap', {
      token,
      body: { tokenIn: 'TGR', tokenOut: 'RUSD', amountIn: 10 },
    });
    assert.equal(blockedAgain.status, 403, `a blacklisted token must be refused, got ${blockedAgain.status}`);
    const unblock = await request('POST', '/api/admin/dex/risk', {
      token: adminToken,
      body: { action: 'unblacklist', kind: 'token', value: 'TGR' },
    });
    assert.equal(unblock.status, 200, `unblacklist failed: ${JSON.stringify(unblock.json)}`);
    record('the blacklist blocks a swap and can be lifted', true);

    const pause = await request('POST', '/api/admin/dex/risk', {
      token: adminToken,
      body: { action: 'pause', scope: 'dex', reason: 'e2e check' },
    });
    assert.equal(pause.status, 200, `pause failed: ${JSON.stringify(pause.json)}`);
    const pausedSwap = await request('POST', '/api/dex/swap', {
      token,
      body: { tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 10 },
    });
    assert.equal(pausedSwap.status, 409, `a paused venue must refuse a swap, got ${pausedSwap.status}`);
    const resume = await request('POST', '/api/admin/dex/risk', {
      token: adminToken,
      body: { action: 'resume', scope: 'dex' },
    });
    assert.equal(resume.status, 200, `resume failed: ${JSON.stringify(resume.json)}`);
    const resumedSwap = await request('POST', '/api/dex/swap', {
      token,
      body: { tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 10 },
    });
    assert.equal(resumedSwap.status, 201, `a resumed venue must settle again, got ${resumedSwap.status}`);
    record('the pause stops settlement and the resume restores it', true);

    const riskList = await request('GET', '/api/admin/dex/risk', { token: adminToken });
    assert.equal(riskList.status, 200, `risk list failed: ${JSON.stringify(riskList.json)}`);
    assert.ok(Array.isArray(riskList.json.controls), 'the risk view must list the controls');
    record('the risk view lists the controls', true);

    // --- Trading intelligence --------------------------------------------
    const intel = await request('GET', '/api/dex/intelligence', { token });
    assert.equal(intel.status, 200, `intelligence failed: ${JSON.stringify(intel.json)}`);
    assert.ok(Array.isArray(intel.json.leaderboard.traders), 'the leaderboard must be a list');
    assert.ok(
      intel.json.leaderboard.traders.some((t) => t.swaps > 0),
      'the leaderboard must include a trader who settled a swap',
    );
    assert.ok(Array.isArray(intel.json.whales), 'the whale feed must be a list');
    assert.ok(Array.isArray(intel.json.signals), 'the smart-money feed must be a list');
    record('trading intelligence reads the settled swaps', true, `${intel.json.leaderboard.traders.length} traders`);

    // --- DEX copy trading -------------------------------------------------
    const leader = seedTrader(`leader-${Date.now()}@example.com`);
    creditBalance(leader.userId, 'RUSD', 500_000);
    const leaderSwap = await request('POST', '/api/dex/swap', {
      token: leader.token,
      body: { tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: 500 },
    });
    assert.equal(leaderSwap.status, 201, `leader swap failed: ${JSON.stringify(leaderSwap.json)}`);

    const apply = await request('POST', '/api/copy/user', {
      token: leader.token,
      body: { displayName: 'E2E Leader', markets: ['RUSD/TGR'] },
    });
    assert.equal(apply.status, 201, `leader application failed: ${JSON.stringify(apply.json)}`);
    const traderId = apply.json.leader.traderId;

    const approve = await request('PUT', '/api/admin/copy', {
      token: adminToken,
      body: { traderId, status: 'approved', maxFollowers: 100, profitShare: 0.1 },
    });
    assert.equal(approve.status, 200, `leader approval failed: ${JSON.stringify(approve.json)}`);

    const follow = await request('POST', '/api/copy/follow', {
      token,
      body: { traderId, mode: 'fixed', amount: 200 },
    });
    assert.equal(follow.status, 201, `follow failed: ${JSON.stringify(follow.json)}`);

    const dexCopy = await request('GET', '/api/dex/copy', { token });
    assert.equal(dexCopy.status, 200, `dex copy list failed: ${JSON.stringify(dexCopy.json)}`);
    assert.ok(Array.isArray(dexCopy.json.pending), 'the pending mirrors must be a list');
    assert.equal(dexCopy.json.pending.length, 1, 'the leader swap must be offered for mirroring');

    // The follower holds only RUSD before the mirror, and holds TGR after it.
    const balanceOf = async (asset) => {
      const res = await request('GET', '/api/wallet/balance', { token });
      const entry = (res.json?.balances ?? []).find((b) => b.coin === asset);
      return Number(entry?.free ?? 0);
    };
    const tgrBefore = await balanceOf('TGR');
    const mirror = await request('POST', '/api/dex/copy', { token, body: { limit: 25 } });
    assert.equal(mirror.status, 200, `mirror failed: ${JSON.stringify(mirror.json)}`);
    assert.equal(mirror.json.mirrored, 1, 'the leader swap must be mirrored once');
    assert.equal(mirror.json.results[0].status, 'mirrored');
    const tgrAfter = await balanceOf('TGR');
    assert.ok(tgrAfter > tgrBefore, 'the mirror must credit the follower with the copied output');

    const afterMirror = await request('GET', '/api/dex/copy', { token });
    assert.equal(afterMirror.json.mirrors.length, 1, 'the mirror must be recorded');
    assert.equal(afterMirror.json.pending.length, 0, 'a leader swap is mirrored at most once');
    const secondMirror = await request('POST', '/api/dex/copy', { token, body: { limit: 25 } });
    assert.equal(secondMirror.json.mirrored, 0, 'a second run must not mirror the same swap again');
    record('DEX copy trading mirrors a leader swap exactly once', true, `TGR ${tgrBefore} -> ${tgrAfter}`);

    // --- Security ---------------------------------------------------------
    for (const [method, url] of [
      ['GET', '/api/dex/vaults'],
      ['POST', '/api/dex/vaults'],
      ['GET', '/api/dex/liquid-staking'],
      ['POST', '/api/dex/liquid-staking'],
      ['POST', '/api/dex/zap'],
      ['GET', '/api/dex/mev?tokenIn=RUSD&tokenOut=TGR&amountIn=1'],
      ['POST', '/api/dex/mev'],
      ['GET', '/api/dex/hooks'],
      ['GET', '/api/dex/sniping?tokenIn=TGR'],
      ['POST', '/api/dex/sniping'],
      ['GET', '/api/dex/bots'],
      ['POST', '/api/dex/bots'],
      ['GET', '/api/dex/intelligence'],
      ['GET', '/api/dex/copy'],
      ['POST', '/api/dex/copy'],
      ['GET', '/api/dex/conditional-orders'],
      ['POST', '/api/dex/conditional-orders'],
      ['DELETE', '/api/dex/conditional-orders'],
      ['GET', '/api/dex/options'],
      ['POST', '/api/dex/options'],
      ['DELETE', '/api/dex/options'],
      ['POST', '/api/dex/perps'],
      ['PATCH', '/api/dex/perps'],
    ]) {
      const response = await request(method, url, method === 'GET' ? {} : { body: {} });
      assert.equal(response.status, 401, `${method} ${url} must require auth, got ${response.status}`);
    }
    record('every new route requires authentication', true);

    const adminGuard = await request('GET', '/api/admin/dex/vaults', { token });
    assert.ok(
      adminGuard.status === 401 || adminGuard.status === 403,
      `a trader token must not open an admin route, got ${adminGuard.status}`,
    );
    const hookGuard = await request('GET', '/api/admin/dex/hooks', { token });
    assert.ok(
      hookGuard.status === 401 || hookGuard.status === 403,
      `a trader token must not open the hook admin route, got ${hookGuard.status}`,
    );
    const botGuard = await request('GET', '/api/admin/dex/bots', { token });
    assert.ok(
      botGuard.status === 401 || botGuard.status === 403,
      `a trader token must not open the bot admin route, got ${botGuard.status}`,
    );
    const riskGuard = await request('GET', '/api/admin/dex/risk', { token });
    assert.ok(
      riskGuard.status === 401 || riskGuard.status === 403,
      `a trader token must not open the risk admin route, got ${riskGuard.status}`,
    );
    const optionGuard = await request('GET', '/api/admin/dex/options', { token });
    assert.ok(
      optionGuard.status === 401 || optionGuard.status === 403,
      `a trader token must not open the options admin route, got ${optionGuard.status}`,
    );
    record('admin routes reject a trader token', true, `status ${adminGuard.status}`);
  } finally {
    // `npm run start` spawns `next start` as a child; killing only npm would
    // leave the server holding the port, so the whole process group is killed.
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      server.kill('SIGKILL');
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error(serverLog.split('\n').slice(-50).join('\n'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
