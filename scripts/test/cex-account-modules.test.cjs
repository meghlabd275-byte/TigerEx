'use strict';
/**
 * Tests for the account-facing modules added for the CEX feature set:
 * notifications, OTC quotes, the trader leaderboard, user bots, launchpool
 * staking, earn holdings, the cross-chain bridge and sub-accounts.
 *
 * Every module is exercised against a real SQLite database, and the assertions
 * cover the refusal cases as well as the happy path: another account's inbox is
 * unreachable, a quote for an unlisted asset is refused, a bridge transfer to a
 * malformed address is refused, a stake without funds is refused.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-cex-')), 'cex.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { creditAvailable, availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const inbox = require('../../.test-build/inbox.js');
const otc = require('../../.test-build/quote.js');
const leaderboard = require('../../.test-build/traders.js');
const botInstances = require('../../.test-build/instances.js');
const launchpool = require('../../.test-build/launchpool.js');
const holdings = require('../../.test-build/holdings.js');
const bridge = require('../../.test-build/bridge.js');
const subaccounts = require('../../.test-build/subaccounts.js');

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
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, currency, available);
}

let pairSeq = 0;
function listPair(base, quote = 'RUSD') {
  pairSeq += 1;
  const pairId = `${base}${quote}-${pairSeq}`;
  const symbol = `${base}/${quote}`;
  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
     VALUES (?, ?, ?, ?, 'active', 0.01, 0.0001, 100000, 1, 0.001, 0.001)`,
  ).run(pairId, base, quote, symbol);
  return { pairId, symbol };
}

function restOrder(pairId, userId, side, price, quantity) {
  db.prepare(
    `INSERT INTO orders (order_id, user_id, pair_id, side, type, price, quantity, filled_quantity, remaining_quantity, status)
     VALUES (?, ?, ?, ?, 'limit', ?, ?, 0, ?, 'open')`,
  ).run(generateId(), userId, pairId, side, price, quantity, quantity);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test('a notification is visible only to its own account', () => {
  const alice = seedUser();
  const bob = seedUser();
  const id = generateId();
  db.prepare(
    `INSERT INTO notifications (notification_id, user_id, type, title, body, severity)
     VALUES (?, ?, 'deposit', 'Deposit confirmed', '1 BTC credited', 'info')`,
  ).run(id, alice);

  const mine = inbox.listNotifications(alice);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, 'Deposit confirmed');
  assert.equal(mine[0].read, false);
  assert.equal(inbox.unreadCount(alice), 1);

  assert.equal(inbox.listNotifications(bob).length, 0);
  assert.throws(() => inbox.markNotificationRead(bob, id), (error) => error.code === 'NOT_FOUND');
});

test('a notification written by the account-event helper lands in the inbox', () => {
  const user = seedUser();
  const created = inbox.createNotification({
    userId: user,
    type: 'security',
    title: 'New sign-in to your account',
    body: 'A new sign-in was recorded from 203.0.113.9.',
    severity: 'warning',
  });

  assert.equal(created.type, 'security');
  assert.equal(created.severity, 'warning');
  assert.equal(created.read, false);

  const listed = inbox.listNotifications(user);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.equal(inbox.unreadCount(user), 1);

  // A notification with no title or body is refused rather than stored blank.
  assert.throws(
    () => inbox.createNotification({ userId: user, title: '  ', body: 'x' }),
    /title and a body/,
  );
});

test('marking a notification read is idempotent and clears the unread count', () => {
  const user = seedUser();
  const id = generateId();
  db.prepare(
    `INSERT INTO notifications (notification_id, user_id, title, body) VALUES (?, ?, 'Hi', 'Body')`,
  ).run(id, user);

  const first = inbox.markNotificationRead(user, id);
  assert.equal(first.read, true);
  assert.equal(inbox.unreadCount(user), 0);

  const second = inbox.markNotificationRead(user, id);
  assert.equal(second.read, true);
  assert.equal(inbox.unreadCount(user), 0);
});

test('marking the whole inbox read reports how many changed', () => {
  const user = seedUser();
  for (let i = 0; i < 3; i += 1) {
    db.prepare('INSERT INTO notifications (notification_id, user_id, title, body) VALUES (?, ?, ?, ?)').run(
      generateId(),
      user,
      `n${i}`,
      'body',
    );
  }
  assert.equal(inbox.markAllNotificationsRead(user), 3);
  assert.equal(inbox.markAllNotificationsRead(user), 0);
  assert.equal(inbox.unreadCount(user), 0);
});

// ---------------------------------------------------------------------------
// OTC quotes
// ---------------------------------------------------------------------------

test('an OTC buy quote walks the asks and pays the spread', () => {
  const seller = seedUser();
  const buyer = seedUser();
  const { pairId, symbol } = listPair('OTCA');
  restOrder(pairId, seller, 'sell', 100, 1);
  restOrder(pairId, seller, 'sell', 110, 1);

  const quote = otc.requestQuote(buyer, 'OTCA', 'buy', 2);
  assert.equal(quote.symbol, symbol);
  // Volume-weighted price over both levels is 105; a buy pays the spread on top.
  assert.ok(Math.abs(quote.quotePrice - 105 * (1 + otc.OTC_SPREAD)) < 1e-6);
  assert.equal(quote.filledAmount, 2);
  assert.equal(quote.unfilledAmount, 0);
  assert.ok(quote.fee > 0);
  assert.equal(quote.status, 'quoted');
});

test('an OTC quote reports the shortfall when the book is too thin', () => {
  const seller = seedUser();
  const buyer = seedUser();
  const { pairId } = listPair('OTCB');
  restOrder(pairId, seller, 'sell', 100, 1);

  const quote = otc.requestQuote(buyer, 'OTCB', 'buy', 5);
  assert.equal(quote.filledAmount, 1);
  assert.equal(quote.unfilledAmount, 4);
});

test('an unlisted asset and a non-positive size are refused', () => {
  const user = seedUser();
  assert.throws(() => otc.requestQuote(user, 'NOPE', 'buy', 1), (error) => error.code === 'UNKNOWN_ASSET');
  assert.throws(() => otc.requestQuote(user, 'OTCB', 'buy', 0), (error) => error.code === 'VALIDATION_FAILED');
  assert.throws(() => otc.requestQuote(user, 'OTCB', 'sideways', 1), (error) => error.code === 'VALIDATION_FAILED');
});

test('a quote is written to history for its own requester only', () => {
  const alice = seedUser();
  const bob = seedUser();
  const { pairId } = listPair('OTCC');
  restOrder(pairId, seedUser(), 'sell', 100, 10);
  otc.requestQuote(alice, 'OTCC', 'buy', 1);

  assert.equal(otc.quoteHistory(alice).length, 1);
  assert.equal(otc.quoteHistory(bob).length, 0);
});

test('an OTC buy settles against desk inventory and the desk keeps the spread', () => {
  const buyer = seedUser();
  const { pairId } = listPair('OTCD');
  restOrder(pairId, seedUser(), 'sell', 100, 10);
  credit(buyer, 'RUSD', 1_000_000);
  otc.fundOtcDesk('OTCD', 10);

  const quote = otc.requestQuote(buyer, 'OTCD', 'buy', 5);
  const gross = quote.amount * quote.quotePrice;
  const fill = otc.executeQuote(buyer, quote.id);

  assert.equal(fill.status, 'filled');
  assert.equal(availableBalance(buyer, 'OTCD'), 5, 'the client receives the base');
  assert.ok(Math.abs(availableBalance(buyer, 'RUSD') - (1_000_000 - gross)) < 1e-6, 'the client pays the quote');
  assert.ok(Math.abs(otc.otcDeskBalance('OTCD') - 5) < 1e-6, 'the desk delivers from its own inventory');
  assert.ok(Math.abs(otc.otcDeskBalance('RUSD') - gross) < 1e-6, 'the desk receives the quote');

  // The quote is one-shot: a second fill is refused.
  assert.throws(() => otc.executeQuote(buyer, quote.id), (error) => error.code === 'QUOTE_NOT_OPEN');
});

test('an OTC fill fails closed when the desk holds no inventory', () => {
  const buyer = seedUser();
  const { pairId } = listPair('OTCE');
  restOrder(pairId, seedUser(), 'sell', 100, 10);
  credit(buyer, 'RUSD', 1_000_000);

  const quote = otc.requestQuote(buyer, 'OTCE', 'buy', 1);
  // The desk was never funded, so it cannot deliver the base.
  assert.throws(() => otc.executeQuote(buyer, quote.id), (error) => error.code === 'DESK_INVENTORY_LOW');
  assert.equal(availableBalance(buyer, 'OTCE'), 0, 'nothing was conjured');
});

test('an OTC fill refuses a client who cannot pay and one who did not ask', () => {
  const buyer = seedUser();
  const other = seedUser();
  const { pairId } = listPair('OTCF');
  restOrder(pairId, seedUser(), 'sell', 100, 10);
  otc.fundOtcDesk('OTCF', 10);
  const quote = otc.requestQuote(buyer, 'OTCF', 'buy', 1);

  // The requester has no RUSD, so the buy cannot settle.
  assert.throws(() => otc.executeQuote(buyer, quote.id), (error) => error.code === 'INSUFFICIENT_BALANCE');
  // Another account cannot fill someone else's quote.
  assert.throws(() => otc.executeQuote(other, quote.id), (error) => error.code === 'QUOTE_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

test('the volume leaderboard ranks the real taker volume', () => {
  const maker = seedUser();
  const taker = seedUser();
  const symbol = 'LDBOOK/RUSD';
  const insertTrade = (makerUser, takerUser, quoteQuantity) =>
    db
      .prepare(
        `INSERT INTO spot_trades (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id, side, price, quantity, quote_quantity)
         VALUES (?, ?, ?, ?, ?, ?, 'buy', 100, ?, ?)`,
      )
      .run(generateId(), symbol, generateId(), generateId(), makerUser, takerUser, quoteQuantity / 100, quoteQuantity);

  insertTrade(maker, taker, 5000);
  insertTrade(taker, maker, 2000);

  const board = leaderboard.traderLeaderboard('traders', 'all', 10);
  const takerEntry = board.find((entry) => entry.user_id === taker);
  const makerEntry = board.find((entry) => entry.user_id === maker);
  assert.ok(takerEntry);
  assert.ok(makerEntry);
  assert.equal(takerEntry.volume, 7000);
  assert.equal(makerEntry.volume, 7000);
  assert.equal(board[0].rank, 1);
});

test('the P&L leaderboard ranks realized futures profit and reports win rate', () => {
  const winner = seedUser();
  const loser = seedUser();
  const insertClosed = (userId, realized, side) =>
    db
      .prepare(
        `INSERT INTO futures_positions (position_id, user_id, symbol, side, quantity, entry_price, mark_price, leverage, margin, liquidation_price, realized_pnl, status)
         VALUES (?, ?, 'LBX/RUSD', ?, 1, 100, 100, 10, 10, 90, ?, 'closed')`,
      )
      .run(generateId(), userId, side, realized);

  insertClosed(winner, 500, 'long');
  insertClosed(winner, 100, 'short');
  insertClosed(loser, -300, 'long');

  const board = leaderboard.traderLeaderboard('pnl', 'all', 10);
  assert.equal(board[0].user_id, winner);
  assert.equal(board[0].pnl, 600);
  assert.equal(board[0].win_rate, 1);
  const last = board[board.length - 1];
  assert.equal(last.user_id, loser);
  assert.equal(last.win_rate, 0);
});

test('the copier board returns only approved leaders', () => {
  const approved = seedUser();
  const pending = seedUser();
  const insertTrader = (userId, status, roi) =>
    db
      .prepare(
        `INSERT INTO copy_traders (trader_id, user_id, display_name, markets, roi_7d, roi_30d, roi_90d, win_rate, followers, max_followers, aum, profit_share, status)
         VALUES (?, ?, ?, '[]', ?, ?, ?, 0.5, 0, 1000, 10000, 0.1, ?)`,
      )
      .run(generateId(), userId, `trader-${userId.slice(0, 6)}`, roi, roi, roi, status);

  insertTrader(approved, 'approved', 0.4);
  insertTrader(pending, 'pending', 0.9);

  const board = leaderboard.traderLeaderboard('copiers', '30d', 10);
  assert.equal(board.length, 1);
  assert.equal(board[0].user_id, approved);
  assert.equal(board[0].roi, 0.4);
});

// ---------------------------------------------------------------------------
// User bots
// ---------------------------------------------------------------------------

test('a bot is created only with runnable parameters', () => {
  const user = seedUser();
  const { symbol } = listPair('BOTA');

  const bot = botInstances.createBot(user, {
    strategy: 'spot_grid',
    symbol,
    params: { lowerPrice: 100, upperPrice: 200, grids: 4 },
  });
  assert.equal(bot.status, 'stopped');
  assert.equal(bot.symbol, symbol);

  assert.throws(
    () =>
      botInstances.createBot(user, {
        strategy: 'spot_grid',
        symbol,
        params: { lowerPrice: 200, upperPrice: 100, grids: 4 },
      }),
    (error) => error.code === 'INVALID_PARAMS',
  );
});

test('a bot on an unlisted market or with an unknown strategy is refused', () => {
  const user = seedUser();
  const { symbol } = listPair('BOTB');
  assert.throws(
    () => botInstances.createBot(user, { strategy: 'spot_grid', symbol: 'NOPE/RUSD', params: {} }),
    (error) => error.code === 'UNKNOWN_MARKET',
  );
  assert.throws(
    () => botInstances.createBot(user, { strategy: 'time_machine', symbol, params: {} }),
    (error) => error.code === 'VALIDATION_FAILED',
  );
});

test('a bot status change is scoped to its owner', () => {
  const owner = seedUser();
  const stranger = seedUser();
  const { symbol } = listPair('BOTC');
  const bot = botInstances.createBot(owner, { strategy: 'twap', symbol, params: { totalQuantity: 10, slices: 3 } });

  const running = botInstances.setBotStatus(owner, bot.id, 'running');
  assert.equal(running.status, 'running');
  assert.equal(botInstances.listUserBots(owner).length, 1);
  assert.equal(botInstances.listUserBots(stranger).length, 0);
  assert.throws(() => botInstances.setBotStatus(stranger, bot.id, 'stopped'), (error) => error.code === 'UNKNOWN_BOT');
});

// ---------------------------------------------------------------------------
// Launchpool
// ---------------------------------------------------------------------------

function createCampaign({ stakeToken = 'RUSD', minStake = 0, apy = 0.2, active = true } = {}) {
  const projectId = generateId();
  const nowNs = Date.now() * 1_000_000;
  const startNs = active ? nowNs - 60_000_000_000 : nowNs + 3_600_000_000_000;
  const endNs = active ? nowNs + 3_600_000_000_000 : nowNs + 7_200_000_000_000;
  db.prepare(
    `INSERT INTO launchpad_projects (project_id, token_symbol, name, sale_price, total_allocation, raised, start_ns, end_ns, vesting, status)
     VALUES (?, 'NEWT', 'New Token Sale', 1, 10000, 0, ?, ?, ?, 'upcoming')`,
  ).run(projectId, startNs, endNs, JSON.stringify({ stakeToken, minStake, apy, description: 'Test campaign' }));
  return projectId;
}

test('a launchpool stake locks the balance and is reported back', () => {
  const user = seedUser();
  credit(user, 'RUSD', 1000);
  const projectId = createCampaign();

  const stake = launchpool.stakeInCampaign(user, projectId, 400);
  assert.equal(stake.stake_amount, 400);
  assert.equal(availableBalance(user, 'RUSD'), 600);
  assert.equal(lockedBalance(user, 'RUSD'), 400);

  const stakes = launchpool.userStakes(user);
  assert.equal(stakes.length, 1);
  assert.equal(stakes[0].project_id, projectId);
});

test('a stake above the balance and below the minimum are refused', () => {
  const user = seedUser();
  credit(user, 'RUSD', 100);
  const projectId = createCampaign({ minStake: 50 });

  assert.throws(
    () => launchpool.stakeInCampaign(user, projectId, 500),
    (error) => error.code === 'INSUFFICIENT_BALANCE',
  );
  assert.throws(
    () => launchpool.stakeInCampaign(user, projectId, 10),
    (error) => error.code === 'VALIDATION_FAILED',
  );
});

test('an upcoming campaign cannot be staked into', () => {
  const user = seedUser();
  credit(user, 'RUSD', 1000);
  const projectId = createCampaign({ active: false });
  assert.throws(
    () => launchpool.stakeInCampaign(user, projectId, 100),
    (error) => error.code === 'CAMPAIGN_NOT_ACTIVE',
  );
});

test('an active campaign lists with its real participation', () => {
  const user = seedUser();
  credit(user, 'RUSD', 1000);
  const projectId = createCampaign();
  launchpool.stakeInCampaign(user, projectId, 250);

  const campaigns = launchpool.listCampaigns('active');
  const campaign = campaigns.find((entry) => entry.project_id === projectId);
  assert.ok(campaign);
  assert.equal(campaign.stake_token, 'RUSD');
  assert.equal(campaign.participants, 1);
  assert.equal(campaign.total_staked, 250);
  assert.equal(campaign.total_rewards, 10000);
});

// ---------------------------------------------------------------------------
// Earn holdings
// ---------------------------------------------------------------------------

test('a flexible holding accrues a reward from its APR', () => {
  const user = seedUser();
  const productId = generateId();
  db.prepare(
    `INSERT INTO earn_products (product_id, name, asset, product_type, apy, duration_days)
     VALUES (?, 'Flexible RUSD', 'RUSD', 'flexible', 0.1, 0)`,
  ).run(productId);
  db.prepare(
    `INSERT INTO earn_subscriptions (subscription_id, user_id, product_id, amount, status, started_at)
     VALUES (?, ?, ?, 1000, 'active', datetime('now', '-365 day'))`,
  ).run(generateId(), user, productId);

  const list = holdings.userHoldings(user);
  assert.equal(list.length, 1);
  assert.equal(list[0].symbol, 'RUSD');
  assert.equal(list[0].locked, false);
  assert.equal(list[0].type, 'flexible');
  // A year at 10% on 1000 is about 100.
  assert.ok(list[0].rewards > 90 && list[0].rewards <= 100.5);
});

test('a locked holding is flagged and its lock period reported', () => {
  const user = seedUser();
  const productId = generateId();
  db.prepare(
    `INSERT INTO earn_products (product_id, name, asset, product_type, apy, duration_days)
     VALUES (?, 'Locked BTC', 'BTC', 'locked', 0.05, 90)`,
  ).run(productId);
  db.prepare(
    `INSERT INTO earn_subscriptions (subscription_id, user_id, product_id, amount, status)
     VALUES (?, ?, ?, 2, 'active')`,
  ).run(generateId(), user, productId);

  const list = holdings.userHoldings(user);
  assert.equal(list[0].locked, true);
  assert.equal(list[0].lock_period, '90 days');
  assert.equal(list[0].lock_period_days, 90);
});

test('a redeemed subscription is not reported as a holding', () => {
  const user = seedUser();
  const productId = generateId();
  db.prepare(
    `INSERT INTO earn_products (product_id, name, asset, product_type, apy, duration_days)
     VALUES (?, 'Flexible', 'USDT', 'flexible', 0.05, 0)`,
  ).run(productId);
  db.prepare(
    `INSERT INTO earn_subscriptions (subscription_id, user_id, product_id, amount, status)
     VALUES (?, ?, ?, 5, 'redeemed')`,
  ).run(generateId(), user, productId);

  assert.equal(holdings.userHoldings(user).length, 0);
  assert.equal(holdings.userHoldings(user, { status: 'redeemed' }).length, 1);
});

// ---------------------------------------------------------------------------
// Cross-chain bridge
// ---------------------------------------------------------------------------

const EVM_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';

test('a bridge transfer debits the source balance and records the destination', () => {
  const user = seedUser();
  credit(user, 'USDT', 1000);

  const transfer = bridge.initiateTransfer({
    userId: user,
    fromChain: 'ETH',
    toChain: 'BSC',
    asset: 'USDT',
    amount: 100,
    toAddress: EVM_ADDRESS,
  });

  assert.equal(transfer.status, 'pending');
  assert.equal(transfer.fromChain, 'ETH');
  assert.equal(transfer.toChain, 'BSC');
  assert.equal(transfer.amount, 100);
  assert.ok(transfer.fee > 0);
  assert.equal(availableBalance(user, 'USDT'), 900 - transfer.fee);
  assert.equal(bridge.transferHistory(user).length, 1);
});

test('a bridge transfer to a malformed address is refused', () => {
  const user = seedUser();
  credit(user, 'USDT', 1000);
  assert.throws(
    () =>
      bridge.initiateTransfer({
        userId: user,
        fromChain: 'ETH',
        toChain: 'BSC',
        asset: 'USDT',
        amount: 10,
        toAddress: '0xnothex',
      }),
    (error) => error.code === 'INVALID_ADDRESS',
  );
  assert.equal(availableBalance(user, 'USDT'), 1000);
});

test('an unsupported chain, a same-chain transfer and an unfunded transfer are refused', () => {
  const user = seedUser();
  credit(user, 'USDT', 10);
  const base = { userId: user, asset: 'USDT', amount: 5, toAddress: EVM_ADDRESS };

  assert.throws(
    () => bridge.initiateTransfer({ ...base, fromChain: 'ETH', toChain: 'MARS' }),
    (error) => error.code === 'UNSUPPORTED_CHAIN',
  );
  assert.throws(
    () => bridge.initiateTransfer({ ...base, fromChain: 'ETH', toChain: 'ETHEREUM' }),
    (error) => error.code === 'VALIDATION_FAILED',
  );
  assert.throws(
    () => bridge.initiateTransfer({ ...base, fromChain: 'ETH', toChain: 'BSC', amount: 1000 }),
    (error) => error.code === 'INSUFFICIENT_BALANCE',
  );
});

// ---------------------------------------------------------------------------
// Sub-accounts
// ---------------------------------------------------------------------------

test('a sub-account is created for its parent and listed back', () => {
  const parent = seedUser();
  const other = seedUser();

  const sub = subaccounts.createSubaccount(parent, 'team@example.com', 'Desk 1', ['trade', 'read']);
  assert.equal(sub.email, 'team@example.com');
  assert.equal(sub.status, 'active');
  assert.deepEqual(sub.permissions, ['trade', 'read']);

  assert.equal(subaccounts.listSubaccounts(parent).length, 1);
  assert.equal(subaccounts.listSubaccounts(other).length, 0);
});

test('a duplicate email and an invalid email are refused', () => {
  const parent = seedUser();
  subaccounts.createSubaccount(parent, 'dup@example.com');
  assert.throws(
    () => subaccounts.createSubaccount(parent, 'dup@example.com'),
    (error) => error.code === 'DUPLICATE_SUBACCOUNT',
  );
  assert.throws(
    () => subaccounts.createSubaccount(parent, 'not-an-email'),
    (error) => error.code === 'VALIDATION_FAILED',
  );
});

test('only the parent can change a sub-account status', () => {
  const parent = seedUser();
  const stranger = seedUser();
  const sub = subaccounts.createSubaccount(parent, 'desk@example.com');

  const frozen = subaccounts.setSubaccountStatus(parent, sub.subaccountId, 'frozen');
  assert.equal(frozen.status, 'frozen');
  assert.throws(
    () => subaccounts.setSubaccountStatus(stranger, sub.subaccountId, 'active'),
    (error) => error.code === 'UNKNOWN_SUBACCOUNT',
  );
  assert.throws(
    () => subaccounts.setSubaccountStatus(parent, sub.subaccountId, 'exploded'),
    (error) => error.code === 'VALIDATION_FAILED',
  );
});
