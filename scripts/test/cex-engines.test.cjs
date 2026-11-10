'use strict';
/**
 * Tests for the trading engines wired into the CEX feature set: copy trading,
 * options, leveraged tokens (ETF), earn subscriptions, account deletion and the
 * P2P profile.
 *
 * Each engine is exercised against a real SQLite database, and the assertions
 * cover the refusal cases as well as the happy path: a follower cannot be sized
 * past their cap, an option whose underlying has no price cannot be quoted, a
 * leveraged token cannot be redeemed beyond what is held, a locked stake cannot
 * be redeemed early, and a deletion with a balance is refused.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-engines-')), 'engines.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';
process.env.TIGEREX_OPTIONS_DEFAULT_VOLATILITY = '0.8';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { creditAvailable, availableBalance } = require('../../.test-build/ledger.js');
const { placeSpotOrder } = require('../../.test-build/spot-engine.js');
const copyEngine = require('../../.test-build/copy-engine.js');
const optionsEngine = require('../../.test-build/options-engine.js');
const etfEngine = require('../../.test-build/etf-engine.js');
const subscriptions = require('../../.test-build/subscriptions.js');
const deletion = require('../../.test-build/account-deletion.js');
const p2pProfile = require('../../.test-build/profile.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare('INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, ?)').run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
    'active',
  );
  return userId;
}

function credit(userId, currency, available) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network)
     VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, currency);
  db.prepare(
    'INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)',
  ).run(generateId(), walletId, currency, available);
}

function setPrice(symbol, price) {
  db.prepare(
    `INSERT INTO market_data (id, symbol, price) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price`,
  ).run(generateId(), symbol, price);
}

function listPair(base, quote = 'RUSD') {
  const pairId = generateId();
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, ?, ?, 'active', 0.01, 0.0001, 100000, 1, 0.001, 0.001)`,
  ).run(pairId, base, quote, `${base}/${quote}`);
  return pairId;
}

function approveLeader(userId, displayName = 'Leader') {
  const traderId = generateId();
  db.prepare(
    `INSERT INTO copy_traders (trader_id, user_id, display_name, status, max_followers, profit_share)
     VALUES (?, ?, ?, 'approved', 100, 0.1)`,
  ).run(traderId, userId, displayName);
  return traderId;
}

function listOption(symbol, underlying, optionType, strike, expiryNs) {
  const marketId = generateId();
  db.prepare(
    `INSERT INTO options_markets
       (market_id, symbol, underlying, settlement_asset, option_type, strike_price, expiry_ns,
        exercise_style, contract_size, tick_size, min_quantity, max_quantity, taker_fee_bps, status)
     VALUES (?, ?, ?, 'RUSD', ?, ?, ?, 'european', 1, 0.01, 1, 100000, 5, 'active')`,
  ).run(marketId, symbol, underlying, optionType, strike, expiryNs);
  return marketId;
}

function listEtf(symbol, underlying, leverage, direction, nav, referencePrice) {
  const marketId = generateId();
  db.prepare(
    `INSERT INTO etf_markets
       (market_id, symbol, underlying, settlement_asset, leverage, direction, nav, reference_price, last_rebalance_ns, status)
     VALUES (?, ?, ?, 'RUSD', ?, ?, ?, ?, ?, 'active')`,
  ).run(marketId, symbol, underlying, leverage, direction, nav, referencePrice, Date.now() * 1e6);
  return marketId;
}

function listEarnProduct(asset, apy, durationDays, minAmount, productType = 'flexible', params = null) {
  const productId = generateId();
  db.prepare(
    `INSERT INTO earn_products (product_id, name, product_type, asset, apy, duration_days, min_amount, status, params)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(productId, `${asset} ${productType}`, productType, asset, apy, durationDays, minAmount, params);
  return productId;
}

// ---------------------------------------------------------------------------
// Copy trading
// ---------------------------------------------------------------------------

test('a follower cannot copy their own account', () => {
  const leader = seedUser();
  const traderId = approveLeader(leader);
  assert.throws(
    () => copyEngine.followLeader(leader, { traderId, mode: 'ratio', ratio: 1 }),
    (error) => error.code === 'CANNOT_COPY_SELF',
  );
});

test('a follower cannot follow a leader that is not approved', () => {
  const leader = seedUser();
  const traderId = generateId();
  db.prepare(
    "INSERT INTO copy_traders (trader_id, user_id, display_name, status) VALUES (?, ?, 'Pending', 'pending')",
  ).run(traderId, leader);

  const follower = seedUser();
  assert.throws(
    () => copyEngine.followLeader(follower, { traderId, mode: 'ratio', ratio: 1 }),
    (error) => error.code === 'TRADER_NOT_APPROVED',
  );
});

test('a fixed-mode follow requires a positive fixed amount', () => {
  const leader = seedUser();
  const traderId = approveLeader(leader);
  const follower = seedUser();
  assert.throws(
    () => copyEngine.followLeader(follower, { traderId, mode: 'fixed' }),
    (error) => error.code === 'VALIDATION_FAILED',
  );
});

test('following increments the leader follower count and can be stopped', () => {
  const leader = seedUser();
  const traderId = approveLeader(leader);
  const follower = seedUser();

  const follow = copyEngine.followLeader(follower, { traderId, mode: 'ratio', ratio: 1, maxPosition: 5000 });
  assert.equal(follow.mode, 'ratio');
  assert.equal(follow.leaderName, 'Leader');

  let count = db.prepare('SELECT followers FROM copy_traders WHERE trader_id = ?').get(traderId).followers;
  assert.equal(count, 1);

  // A duplicate follow is refused rather than double-counted.
  assert.throws(
    () => copyEngine.followLeader(follower, { traderId, mode: 'ratio', ratio: 1 }),
    (error) => error.code === 'ALREADY_FOLLOWING',
  );

  copyEngine.unfollow(follower, follow.followId);
  count = db.prepare('SELECT followers FROM copy_traders WHERE trader_id = ?').get(traderId).followers;
  assert.equal(count, 0);
  assert.equal(copyEngine.listFollowing(follower).length, 0);
});

test('a follower is never sized past their configured maximum', () => {
  const leader = seedUser();
  const traderId = approveLeader(leader);
  const follower = seedUser();
  credit(follower, 'RUSD', 1000);
  credit(leader, 'RUSD', 100000);
  listPair('BTC');

  copyEngine.followLeader(follower, { traderId, mode: 'ratio', ratio: 1, maxPosition: 100 });

  // The leader's fill is a 1 BTC order at 50,000; a follower with 1,000 RUSD
  // and a 100 RUSD cap can mirror at most 100 RUSD of notional.
  const orderId = generateId();
  const pairId = db.prepare("SELECT pair_id FROM trading_pairs WHERE symbol = 'BTC/RUSD'").get().pair_id;
  db.prepare(
    `INSERT INTO orders (order_id, user_id, pair_id, side, type, price, quantity, filled_quantity, remaining_quantity, status)
     VALUES (?, ?, ?, 'buy', 'market', 50000, 1, 1, 0, 'filled')`,
  ).run(orderId, leader, pairId);
  db.prepare(
    `INSERT INTO order_history (history_id, order_id, user_id, pair_id, side, type, price, quantity, filled_quantity, average_price, status)
     VALUES (?, ?, ?, ?, 'buy', 'market', 50000, 1, 1, 50000, 'filled')`,
  ).run(generateId(), orderId, leader, pairId);

  const mirrored = copyEngine.mirroredOrders(follower);
  assert.ok(mirrored.length >= 1);
  assert.ok(mirrored[0].notional <= 100 + 1e-6, `notional ${mirrored[0].notional} must be capped at 100`);
});

test('a leader profile is created pending and metrics are zero with no history', () => {
  const user = seedUser();
  const leader = copyEngine.applyAsLeader(user, { displayName: 'Alice', markets: ['btc/rusd'] });
  assert.equal(leader.status, 'pending');
  assert.deepEqual(leader.markets, ['BTC/RUSD']);

  // Applying twice is refused.
  assert.throws(
    () => copyEngine.applyAsLeader(user, { displayName: 'Alice' }),
    (error) => error.code === 'ALREADY_APPLIED',
  );
});

/** Record a settled leader fill in both orders and order_history. */
function leaderFill(leader, symbol, side, price, quantity) {
  const pairId = db.prepare('SELECT pair_id FROM trading_pairs WHERE symbol = ?').get(symbol).pair_id;
  const orderId = generateId();
  const historyId = generateId();
  db.prepare(
    `INSERT INTO orders (order_id, user_id, pair_id, side, type, price, quantity, filled_quantity, remaining_quantity, status)
     VALUES (?, ?, ?, ?, 'market', ?, ?, ?, 0, 'filled')`,
  ).run(orderId, leader, pairId, side, price, quantity, quantity);
  db.prepare(
    `INSERT INTO order_history (history_id, order_id, user_id, pair_id, side, type, price, quantity, filled_quantity, average_price, status)
     VALUES (?, ?, ?, ?, ?, 'market', ?, ?, ?, ?, 'filled')`,
  ).run(historyId, orderId, leader, pairId, side, price, quantity, quantity, price);
  return historyId;
}

test('a copy sweep places a real mirrored order for the follower', () => {
  const leader = seedUser();
  const traderId = approveLeader(leader);
  const follower = seedUser();
  credit(leader, 'RUSD', 100000);
  credit(leader, 'BTC', 5);
  credit(follower, 'RUSD', 100000);
  credit(follower, 'BTC', 5);
  listPair('COPYA');

  // A resting sell, placed through the real engine so the maker's base is
  // actually reserved, gives the follower's mirrored market buy something to
  // take.
  const maker = seedUser();
  credit(maker, 'COPYA', 100);
  placeSpotOrder(maker, { symbol: 'COPYA/RUSD', side: 'sell', type: 'limit', price: 50, quantity: 100 });

  copyEngine.followLeader(follower, { traderId, mode: 'ratio', ratio: 1, maxPosition: 5000 });
  const historyId = leaderFill(leader, 'COPYA/RUSD', 'buy', 50, 1);

  const results = copyEngine.runCopySweep();
  const placed = results.filter((row) => row.status === 'placed');
  assert.equal(placed.length, 1);
  assert.equal(placed[0].symbol, 'COPYA/RUSD');
  assert.equal(placed[0].side, 'buy');
  assert.ok(placed[0].orderId, 'a mirrored order id must be returned');

  // The order exists and is attributed to the follower, and the execution is
  // recorded against the leader fill.
  const row = db.prepare('SELECT user_id, bot_id FROM orders WHERE order_id = ?').get(placed[0].orderId);
  assert.equal(row.user_id, follower);
  const execution = db
    .prepare('SELECT status, follower_order_id FROM copy_executions WHERE leader_history_id = ?')
    .get(historyId);
  assert.equal(execution.status, 'placed');
  assert.equal(execution.follower_order_id, placed[0].orderId);
});

test('a second copy sweep does not mirror the same leader fill twice', () => {
  const leader = seedUser();
  const traderId = approveLeader(leader);
  const follower = seedUser();
  credit(leader, 'RUSD', 100000);
  credit(leader, 'BTC', 5);
  credit(follower, 'RUSD', 100000);
  listPair('COPYB');

  const maker = seedUser();
  credit(maker, 'COPYB', 100);
  placeSpotOrder(maker, { symbol: 'COPYB/RUSD', side: 'sell', type: 'limit', price: 50, quantity: 100 });

  copyEngine.followLeader(follower, { traderId, mode: 'ratio', ratio: 1, maxPosition: 5000 });
  leaderFill(leader, 'COPYB/RUSD', 'buy', 50, 1);

  assert.equal(copyEngine.runCopySweep().filter((r) => r.status === 'placed').length, 1);
  // The unique key on (follow_id, leader_history_id) means the re-run finds no
  // new fills at all.
  assert.equal(copyEngine.runCopySweep().filter((r) => r.status === 'placed').length, 0);
});

test('a follower with no balance records a skipped execution rather than throwing', () => {
  const leader = seedUser();
  const traderId = approveLeader(leader);
  const follower = seedUser();
  credit(leader, 'RUSD', 100000);
  credit(leader, 'BTC', 5);
  // The follower has a token balance, so the copy path is attempted and the
  // order itself is refused for want of funds.
  credit(follower, 'RUSD', 1);
  listPair('COPYC');

  // Liquidity exists, so the only reason the mirrored order fails is the
  // follower's own balance.
  const maker = seedUser();
  credit(maker, 'COPYC', 100);
  placeSpotOrder(maker, { symbol: 'COPYC/RUSD', side: 'sell', type: 'limit', price: 50, quantity: 100 });

  copyEngine.followLeader(follower, { traderId, mode: 'fixed', fixedAmount: 100 });
  const historyId = leaderFill(leader, 'COPYC/RUSD', 'buy', 50, 1);

  const results = copyEngine.runCopySweep();
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'skipped');
  assert.match(results[0].reason, /insufficient/i);

  // The refusal is recorded, so the fill is not retried forever.
  const execution = db.prepare('SELECT status, reason FROM copy_executions WHERE leader_history_id = ?').get(historyId);
  assert.equal(execution.status, 'skipped');
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

test('an option whose underlying has no price cannot be quoted', () => {
  const marketId = generateId();
  db.prepare(
    `INSERT INTO options_markets
       (market_id, symbol, underlying, settlement_asset, option_type, strike_price, expiry_ns, tick_size, min_quantity, max_quantity)
     VALUES (?, 'BTC-UNPRICED-CALL', 'UNPRICEDASSET', 'RUSD', 'call', 50000, ?, 0.01, 1, 100)`,
  ).run(marketId, Date.now() * 1e6 + 86400e9);

  const market = optionsEngine.getOptionsMarket('BTC-UNPRICED-CALL');
  assert.ok(market);
  assert.throws(() => optionsEngine.quoteContract(market), (error) => error.code === 'NO_UNDERLYING_PRICE');
});

test('a long option debits the premium and a close realizes the difference', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  setPrice('BTCUSDT', 50000);
  const expiryNs = Date.now() * 1e6 + 30 * 86400e9;
  listOption('BTC-50000-C', 'BTC', 'call', 50000, expiryNs);

  const position = optionsEngine.openPosition({ userId: user, symbol: 'BTC-50000-C', side: 'long', quantity: 1 });
  assert.equal(position.side, 'long');
  assert.ok(position.entryPrice > 0);
  assert.ok(availableBalance(user, 'RUSD') < 100000);

  // The mark moved up, so closing realizes a profit.
  setPrice('BTCUSDT', 60000);
  const closed = optionsEngine.closePosition({ userId: user, symbol: 'BTC-50000-C', side: 'long' });
  assert.equal(closed.closed, 1);
  assert.ok(closed.realizedPnl > 0, `expected a profit, got ${closed.realizedPnl}`);
});

test('an option position cannot be opened without the funds for its premium', () => {
  const user = seedUser();
  credit(user, 'RUSD', 1);
  setPrice('ETHUSDT', 3000);
  listOption('ETH-3000-C', 'ETH', 'call', 3000, Date.now() * 1e6 + 30 * 86400e9);

  assert.throws(
    () => optionsEngine.openPosition({ userId: user, symbol: 'ETH-3000-C', side: 'long', quantity: 100 }),
    (error) => error.code === 'INSUFFICIENT_BALANCE',
  );
});

test('an expired option contract cannot be opened', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  setPrice('BTCUSDT', 50000);
  const expiryNs = Date.now() * 1e6 - 1000;
  listOption('BTC-EXPIRED-C', 'BTC', 'call', 40000, expiryNs);

  assert.throws(
    () => optionsEngine.openPosition({ userId: user, symbol: 'BTC-EXPIRED-C', side: 'long', quantity: 1 }),
    (error) => error.code === 'CONTRACT_EXPIRED',
  );
});

test('a written option returns its collateral at settlement when it expires out of the money', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  setPrice('BTCUSDT', 50000);
  const expiryNs = Date.now() * 1e6 + 30 * 86400e9;
  listOption('BTC-60000-C-W', 'BTC', 'call', 60000, expiryNs);

  const before = availableBalance(user, 'RUSD');
  const position = optionsEngine.openPosition({ userId: user, symbol: 'BTC-60000-C-W', side: 'short', quantity: 1 });
  const afterOpen = availableBalance(user, 'RUSD');
  assert.ok(afterOpen < before, 'the writer posts the premium as collateral');

  // Expire out of the money: the intrinsic is zero, so the writer keeps the
  // collateral and loses only the taker fee charged when the position opened.
  const market = optionsEngine.getOptionsMarket('BTC-60000-C-W');
  const result = optionsEngine.settleExpired(market, expiryNs / 1e6 + 1000);
  assert.equal(result.settled, 1);
  const afterSettle = availableBalance(user, 'RUSD');

  // The posted collateral (the premium) comes back; the old path left it with
  // the venue and destroyed it.
  assert.ok(
    Math.abs(afterSettle - afterOpen - position.entryPrice) < 1e-6,
    `collateral returned: recovered ${afterSettle - afterOpen}, premium ${position.entryPrice}`,
  );
});

// ---------------------------------------------------------------------------
// Leveraged tokens (ETF)
// ---------------------------------------------------------------------------

test('a subscription mints tokens at the live NAV and a redemption burns them', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  setPrice('BTCUSDT', 50000);
  listEtf('BTC3L', 'BTC', 3, 'long', 50000, 50000);

  const position = etfEngine.subscribe({ userId: user, symbol: 'BTC3L', amount: 1000 });
  assert.ok(position.tokens > 0);
  assert.ok(availableBalance(user, 'RUSD') < 10000);

  const result = etfEngine.redeem({ userId: user, symbol: 'BTC3L', tokens: position.tokens });
  assert.ok(result.proceeds > 0);
});

test('a leveraged token cannot be redeemed beyond what is held', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  setPrice('ETHUSDT', 3000);
  listEtf('ETH3S', 'ETH', 3, 'short', 3000, 3000);

  const position = etfEngine.subscribe({ userId: user, symbol: 'ETH3S', amount: 100 });
  assert.throws(
    () => etfEngine.redeem({ userId: user, symbol: 'ETH3S', tokens: position.tokens + 1 }),
    (error) => error.code === 'INSUFFICIENT_TOKENS',
  );
});

test('a leveraged token NAV moves with the underlying by its leverage', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100000);
  setPrice('BTCUSDT', 50000);
  listEtf('BTC5L', 'BTC', 5, 'long', 50000, 50000);

  const quote = etfEngine.quoteToken(etfEngine.getEtfMarket('BTC5L'));
  assert.ok(Math.abs(quote.nav - 50000) < 1, `nav ${quote.nav} should be near the reference price`);

  // The underlying rises 10%; a 5x token should rise roughly 50% before fees.
  setPrice('BTCUSDT', 55000);
  const moved = etfEngine.quoteToken(etfEngine.getEtfMarket('BTC5L'));
  assert.ok(moved.nav > quote.nav, 'the NAV must rise with the underlying');
  assert.ok(moved.nav < quote.nav * 2, 'the NAV must not exceed twice the reference for a 5x token');
});

// ---------------------------------------------------------------------------
// Earn subscriptions
// ---------------------------------------------------------------------------

test('a flexible subscription locks the principal and redeems with a reward', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  const productId = listEarnProduct('RUSD', 0.1, null, 10);

  const subscription = subscriptions.subscribe({ userId: user, productId, amount: 1000 });
  assert.equal(subscription.asset, 'RUSD');
  assert.equal(subscription.maturesAt, null);

  // The principal is locked, not spent, so it is still on the balance.
  const result = subscriptions.redeem(user, subscription.subscriptionId);
  assert.equal(result.principal, 1000);
  assert.ok(result.reward >= 0);
});

test('a locked subscription cannot be redeemed before it matures', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  const productId = listEarnProduct('RUSD', 0.15, 90, 10, 'locked');

  const subscription = subscriptions.subscribe({ userId: user, productId, amount: 1000 });
  assert.ok(subscription.maturesAt);
  assert.throws(
    () => subscriptions.redeem(user, subscription.subscriptionId),
    (error) => error.code === 'LOCKED',
  );
});

test('a subscription below the product minimum is refused', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  const productId = listEarnProduct('RUSD', 0.1, null, 100);
  assert.throws(
    () => subscriptions.subscribe({ userId: user, productId, amount: 50 }),
    (error) => error.code === 'VALIDATION_FAILED',
  );
});

test('a subscription without the balance is refused', () => {
  const user = seedUser();
  const productId = listEarnProduct('RUSD', 0.1, null, 10);
  assert.throws(
    () => subscriptions.subscribe({ userId: user, productId, amount: 1000 }),
    (error) => error.code === 'INSUFFICIENT_BALANCE',
  );
});

test('an unfunded earn product pays no reward instead of minting one', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  const productId = listEarnProduct('RUSD', 0.5, null, 10);

  const subscription = subscriptions.subscribe({ userId: user, productId, amount: 1000 });
  // Backdate the start a year so the accrual is large, then redeem with the
  // reward account empty: the principal must come back and the reward must not.
  db.prepare("UPDATE earn_subscriptions SET started_at = datetime('now', '-400 days') WHERE subscription_id = ?").run(
    subscription.subscriptionId,
  );
  const before = availableBalance(user, 'RUSD');
  const result = subscriptions.redeem(user, subscription.subscriptionId);

  assert.ok(result.reward > 0, 'the subscription still reports the accrued reward');
  // Only the principal returns; the reward is not minted.
  assert.equal(availableBalance(user, 'RUSD'), before + 1000, 'an unfunded reward must not be minted');
});

test('a funded earn reward account pays up to its balance', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  const productId = listEarnProduct('RUSD', 0.5, null, 10);

  const subscription = subscriptions.subscribe({ userId: user, productId, amount: 1000 });
  db.prepare("UPDATE earn_subscriptions SET started_at = datetime('now', '-400 days') WHERE subscription_id = ?").run(
    subscription.subscriptionId,
  );
  subscriptions.fundEarnRewards('RUSD', 100);
  assert.equal(subscriptions.earnRewardFundBalance('RUSD'), 100);

  const before = availableBalance(user, 'RUSD');
  const result = subscriptions.redeem(user, subscription.subscriptionId);
  assert.ok(result.reward > 100, 'the accrued reward exceeds the funded amount');
  // The principal returns plus the funded 100; nothing beyond the fund is minted.
  assert.equal(availableBalance(user, 'RUSD'), before + 1000 + 100);
  assert.equal(subscriptions.earnRewardFundBalance('RUSD'), 0);
});

test('a dual-investment keeps the quote when the settlement price is above the strike', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  setPrice('BTC/USDT', 50000);
  const params = JSON.stringify({ underlying: 'BTC', strike: 40000, direction: 'buy_low' });
  const productId = listEarnProduct('RUSD', 0.1, 30, 10, 'dual_investment', params);

  const subscription = subscriptions.subscribe({ userId: user, productId, amount: 1000 });
  db.prepare("UPDATE earn_subscriptions SET started_at = datetime('now', '-31 days') WHERE subscription_id = ?").run(
    subscription.subscriptionId,
  );
  subscriptions.fundEarnRewards('RUSD', 100);

  const before = availableBalance(user, 'RUSD');
  const result = subscriptions.redeem(user, subscription.subscriptionId);

  assert.equal(result.asset, 'RUSD');
  assert.equal(result.principal, 1000);
  assert.ok(result.reward > 0, 'the yield is paid regardless of conversion');
  // Principal returns plus the funded reward; nothing is minted beyond the fund.
  assert.equal(availableBalance(user, 'RUSD'), before + 1000 + result.reward);
  assert.equal(subscriptions.earnRewardFundBalance('RUSD'), 100 - result.reward);
});

test('a dual-investment converts to the base asset below the strike', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  setPrice('BTC/USDT', 30000);
  const params = JSON.stringify({ underlying: 'BTC', strike: 40000, direction: 'buy_low' });
  const productId = listEarnProduct('RUSD', 0.1, 30, 10, 'dual_investment', params);

  const subscription = subscriptions.subscribe({ userId: user, productId, amount: 1000 });
  db.prepare("UPDATE earn_subscriptions SET started_at = datetime('now', '-31 days') WHERE subscription_id = ?").run(
    subscription.subscriptionId,
  );
  const expectedPayout = (1000 + 1000 * 0.1 * (30 / 365)) / 40000;
  subscriptions.fundEarnRewards('BTC', expectedPayout);

  const before = availableBalance(user, 'RUSD');
  const result = subscriptions.redeem(user, subscription.subscriptionId);

  assert.equal(result.asset, 'BTC');
  // The quote principal is consumed, not returned.
  assert.equal(availableBalance(user, 'RUSD'), before);
  assert.ok(Math.abs(availableBalance(user, 'BTC') - expectedPayout) < 1e-9);
  assert.equal(subscriptions.earnRewardFundBalance('BTC'), 0);
});

test('a shark fin pays the maximum yield when settlement is inside the range', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  setPrice('BTC/USDT', 50000);
  const params = JSON.stringify({ underlying: 'BTC', lowerBound: 40000, upperBound: 60000, minYield: 0.01, maxYield: 0.2 });
  const productId = listEarnProduct('RUSD', 0.2, 30, 10, 'shark_fin', params);

  const subscription = subscriptions.subscribe({ userId: user, productId, amount: 1000 });
  db.prepare("UPDATE earn_subscriptions SET started_at = datetime('now', '-31 days') WHERE subscription_id = ?").run(
    subscription.subscriptionId,
  );
  subscriptions.fundEarnRewards('RUSD', 500);

  const before = availableBalance(user, 'RUSD');
  const result = subscriptions.redeem(user, subscription.subscriptionId);

  assert.equal(result.asset, 'RUSD');
  assert.equal(result.principal, 1000);
  assert.ok(Math.abs(result.reward - 200) < 1e-9);
  assert.equal(availableBalance(user, 'RUSD'), before + 1000 + 200);
});

test('a structured product without a settlement price is refused, not settled on a guess', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  // The underlying is never listed, so it cannot be valued. A dedicated symbol
  // is used because market data is shared across the test database.
  const params = JSON.stringify({ underlying: 'ZZZZ', strike: 40000, direction: 'buy_low' });
  const productId = listEarnProduct('RUSD', 0.1, 30, 10, 'dual_investment', params);

  const subscription = subscriptions.subscribe({ userId: user, productId, amount: 1000 });
  db.prepare("UPDATE earn_subscriptions SET started_at = datetime('now', '-31 days') WHERE subscription_id = ?").run(
    subscription.subscriptionId,
  );
  assert.throws(
    () => subscriptions.redeem(user, subscription.subscriptionId),
    (error) => error.code === 'NO_SETTLEMENT_PRICE',
  );
  // The subscription is untouched and can be retried once a price exists.
  const status = db.prepare('SELECT status FROM earn_subscriptions WHERE subscription_id = ?').get(subscription.subscriptionId).status;
  assert.equal(status, 'active');
});

test('subscribing to a structured product with invalid terms is refused', () => {
  const user = seedUser();
  credit(user, 'RUSD', 10000);
  const params = JSON.stringify({ underlying: 'BTC', lowerBound: 110, upperBound: 90, minYield: 0.01, maxYield: 0.2 });
  const productId = listEarnProduct('RUSD', 0.1, 30, 10, 'shark_fin', params);
  assert.throws(
    () => subscriptions.subscribe({ userId: user, productId, amount: 1000 }),
    (error) => error.code === 'INVALID_PRODUCT',
  );
});

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

test('a deletion request with a remaining balance is refused', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100);
  const email = `${user}@example.com`;
  const code = crypto.createHash('sha256').update(`${email}:123456`).digest('hex');
  db.prepare(
    `INSERT INTO otp_codes (otp_id, type, purpose, user_id, email, code, expires_at)
     VALUES (?, 'email', 'account_deletion', ?, ?, ?, datetime('now', '+10 minutes'))`,
  ).run(generateId(), user, email, code);

  assert.equal(deletion.deletionRequested(user), false);
  assert.throws(
    () => deletion.confirmDeletion(user, '123456'),
    (error) => error.code === 'BALANCE_NOT_EMPTY',
  );
});

test('a deletion with no balance and no orders succeeds and revokes sessions', () => {
  const user = seedUser();
  const email = `${user}@example.com`;
  const sessionId = generateId();
  db.prepare(
    `INSERT INTO sessions (session_id, user_id, access_token, expires_at)
     VALUES (?, ?, 'token', datetime('now', '+1 day'))`,
  ).run(sessionId, user);
  const code = crypto.createHash('sha256').update(`${email}:123456`).digest('hex');
  db.prepare(
    `INSERT INTO otp_codes (otp_id, type, purpose, user_id, email, code, expires_at)
     VALUES (?, 'email', 'account_deletion', ?, ?, ?, datetime('now', '+10 minutes'))`,
  ).run(generateId(), user, email, code);

  const result = deletion.confirmDeletion(user, '123456');
  assert.equal(result.status, 'pending_deletion');

  const status = db.prepare('SELECT status FROM users WHERE user_id = ?').get(user).status;
  assert.equal(status, 'pending_deletion');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user).n, 0);
});

// ---------------------------------------------------------------------------
// P2P profile
// ---------------------------------------------------------------------------

test('a P2P profile reports a real completion rate and settings round-trip', () => {
  const user = seedUser();
  const profile = p2pProfile.merchantProfile(user);
  assert.equal(profile.totalOrders, 0);
  assert.equal(profile.completionRate, 0);

  const settings = p2pProfile.updateP2pSettings(user, { autoReply: 'Thanks', paymentWindowMinutes: 30, blockedCounterparties: ['abc'] });
  assert.equal(settings.autoReply, 'Thanks');
  assert.equal(settings.paymentWindowMinutes, 30);
  assert.deepEqual(settings.blockedCounterparties, ['abc']);

  const reloaded = p2pProfile.p2pSettings(user);
  assert.equal(reloaded.autoReply, 'Thanks');
  assert.equal(p2pProfile.isBlocked(user, 'abc'), true);
  assert.equal(p2pProfile.isBlocked(user, 'def'), false);

  assert.throws(
    () => p2pProfile.updateP2pSettings(user, { paymentWindowMinutes: 0 }),
    (error) => error.code === 'VALIDATION_FAILED',
  );
});

test('a P2P completion rate reflects settled orders', () => {
  const user = seedUser();
  db.prepare(
    `INSERT INTO p2p_orders (order_id, offer_id, buyer_id, seller_id, asset, fiat, price, amount, escrow_amount, payment_method, status)
     VALUES (?, 'offer', ?, ?, 'RUSD', 'USD', 1, 100, 100, 'bank', 'completed')`,
  ).run(generateId(), user, seedUser());
  db.prepare(
    `INSERT INTO p2p_orders (order_id, offer_id, buyer_id, seller_id, asset, fiat, price, amount, escrow_amount, payment_method, status)
     VALUES (?, 'offer', ?, ?, 'RUSD', 'USD', 1, 100, 100, 'bank', 'pending')`,
  ).run(generateId(), user, seedUser());

  const profile = p2pProfile.merchantProfile(user);
  assert.equal(profile.totalOrders, 2);
  assert.equal(profile.completedOrders, 1);
  assert.equal(profile.completionRate, 0.5);
});
