'use strict';
/**
 * P2P marketplace and rewards tests against a real database.
 *
 * Every case drives the production functions: an ad escrows real funds, an
 * order escrows the crypto side before fiat moves, and the escrow is released
 * or returned exactly once. Coupons and red packets are exercised the same way,
 * including the double-claim and double-redeem cases the schema is meant to
 * prevent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-p2p-')), 'p2p.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { availableBalance, lockedBalance } = require('../../.test-build/ledger.js');
const {
  listAds,
  createAd,
  closeAd,
  placeOrder,
  advanceOrder,
  resolveDispute,
  userOrders,
  paymentMethods,
  P2pError,
} = require('../../.test-build/market.js');
const {
  stakingPools,
  userCoupons,
  redeemCoupon,
  createRedPacket,
  claimRedPacket,
  refundRedPacket,
  sweepExpiredRedPackets,
  RewardsError,
} = require('../../.test-build/rewards.js');
const { isBlocked, updateP2pSettings } = require('../../.test-build/profile.js');

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

function fund(userId, asset, amount) {
  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network) VALUES (?, ?, 'spot', ?, 'TIGEREX')`,
  ).run(walletId, userId, asset);
  db.prepare(
    `INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, ?, 0)`,
  ).run(generateId(), walletId, asset, amount);
}

function ad(sellerId, available = 100) {
  return createAd({
    userId: sellerId,
    side: 'sell',
    asset: 'USDT',
    fiat: 'USD',
    price: 1.01,
    minAmount: 1,
    maxAmount: 1000,
    available,
    paymentMethods: ['Bank Transfer', 'PayPal'],
  });
}

test('a sell ad escrows the advertised quantity', () => {
  const seller = seedUser();
  fund(seller, 'USDT', 100);

  const created = ad(seller, 60);
  assert.equal(created.available, 60);
  assert.equal(availableBalance(seller, 'USDT'), 40);
  assert.equal(lockedBalance(seller, 'USDT'), 60);
});

test('closing an ad returns the remaining escrow', () => {
  const seller = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 60);

  closeAd(seller, created.id);
  assert.equal(availableBalance(seller, 'USDT'), 100);
  assert.equal(lockedBalance(seller, 'USDT'), 0);
  // The closed ad is no longer in the marketplace listing.
  assert.equal(listAds({ asset: 'USDT', fiat: 'USD' }).some((entry) => entry.id === created.id), false);
});

test('a seller cannot close another account\'s ad', () => {
  const seller = seedUser();
  const other = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 60);

  assert.throws(
    () => closeAd(other, created.id),
    (error) => error instanceof P2pError && error.code === 'FORBIDDEN',
  );
  assert.equal(lockedBalance(seller, 'USDT'), 60);
});

test('payment methods are derived from live ads', () => {
  const seller = seedUser();
  fund(seller, 'USDT', 100);
  ad(seller, 50);

  const methods = paymentMethods();
  assert.ok(methods.includes('Bank Transfer'));
  assert.ok(methods.includes('PayPal'));
});

test('placing an order escrows the crypto side, and release pays the buyer', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);

  const order = placeOrder({
    buyerId: buyer,
    offerId: created.id,
    amount: 40,
    paymentMethod: 'Bank Transfer',
  });
  assert.equal(order.escrowAmount, 40);
  // The ad's escrow already covers the trade, so nothing is locked twice.
  assert.equal(lockedBalance(seller, 'USDT'), 100);
  assert.equal(availableBalance(buyer, 'USDT'), 0);

  // The buyer confirms the fiat payment, then the seller releases.
  assert.equal(advanceOrder(buyer, order.orderId, 'pay').status, 'paid');
  const released = advanceOrder(seller, order.orderId, 'release');
  assert.equal(released.status, 'released');
  assert.equal(availableBalance(buyer, 'USDT'), 40);
  assert.equal(lockedBalance(seller, 'USDT'), 60); // the ad's remaining escrow
});

test('cancelling an order returns the escrow to the seller and re-opens the ad', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);

  const order = placeOrder({ buyerId: buyer, offerId: created.id, amount: 40, paymentMethod: 'PayPal' });
  advanceOrder(buyer, order.orderId, 'cancel');

  // The ad's escrow was never released, only reserved, so it is still locked
  // and the ad shows the full amount available again.
  assert.equal(lockedBalance(seller, 'USDT'), 100);
  const ad2 = listAds({ asset: 'USDT' }).find((entry) => entry.id === created.id);
  assert.ok(ad2, 'the ad should be listed again');
  assert.equal(ad2.available, 100); // the order's 40 went back to the ad
  assert.equal(availableBalance(buyer, 'USDT'), 0);
});

test('an order above the ad limits is refused and escrows nothing', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);

  assert.throws(
    () => placeOrder({ buyerId: buyer, offerId: created.id, amount: 5000, paymentMethod: 'PayPal' }),
    (error) => error instanceof P2pError && error.code === 'OUT_OF_LIMITS',
  );
  assert.equal(lockedBalance(seller, 'USDT'), 100);
});

test('a payment method the ad does not offer is refused', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);

  assert.throws(
    () => placeOrder({ buyerId: buyer, offerId: created.id, amount: 10, paymentMethod: 'Wire' }),
    (error) => error instanceof P2pError && error.code === 'VALIDATION_FAILED',
  );
});

test('a blocked counterparty cannot place an order against the ad', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);

  updateP2pSettings(seller, { blockedCounterparties: [buyer] });
  assert.equal(isBlocked(seller, buyer), true);

  assert.throws(
    () => placeOrder({ buyerId: buyer, offerId: created.id, amount: 10, paymentMethod: 'PayPal' }),
    (error) => error instanceof P2pError && error.code === 'COUNTERPARTY_BLOCKED',
  );

  // The taker blocking the advertiser is enforced just the same.
  updateP2pSettings(seller, { blockedCounterparties: [] });
  updateP2pSettings(buyer, { blockedCounterparties: [seller] });
  assert.throws(
    () => placeOrder({ buyerId: buyer, offerId: created.id, amount: 10, paymentMethod: 'PayPal' }),
    (error) => error instanceof P2pError && error.code === 'COUNTERPARTY_BLOCKED',
  );
});

test('only the buyer can mark a payment as sent', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);
  const order = placeOrder({ buyerId: buyer, offerId: created.id, amount: 10, paymentMethod: 'PayPal' });

  assert.throws(
    () => advanceOrder(seller, order.orderId, 'pay'),
    (error) => error instanceof P2pError && error.code === 'FORBIDDEN',
  );

  const paid = advanceOrder(buyer, order.orderId, 'pay');
  assert.equal(paid.status, 'paid');
});

test('a dispute keeps the escrow locked until an operator resolves it', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);
  const order = placeOrder({ buyerId: buyer, offerId: created.id, amount: 40, paymentMethod: 'PayPal' });
  advanceOrder(buyer, order.orderId, 'pay');
  advanceOrder(buyer, order.orderId, 'dispute', { reason: 'seller not responding' });

  // Nothing moved while the dispute is open.
  assert.equal(availableBalance(buyer, 'USDT'), 0);
  assert.equal(lockedBalance(seller, 'USDT'), 100);

  advanceOrder(seller, order.orderId, 'resolve', { splitToBuyer: 25, reason: 'partial' });
  assert.equal(availableBalance(buyer, 'USDT'), 25);
  assert.equal(lockedBalance(seller, 'USDT'), 60); // ad escrow only
});

test('an operator resolution releases the escrow without the caller being a party', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);
  const order = placeOrder({ buyerId: buyer, offerId: created.id, amount: 40, paymentMethod: 'PayPal' });
  advanceOrder(buyer, order.orderId, 'pay');
  advanceOrder(buyer, order.orderId, 'dispute', { reason: 'seller not responding' });

  // The operator is neither the buyer nor the seller, so it must go through the
  // operator resolver rather than `advanceOrder`.
  const result = resolveDispute(order.orderId, 10, 'release_to_buyer');
  assert.equal(result.status, 'released');
  assert.equal(availableBalance(buyer, 'USDT'), 10);
  assert.equal(availableBalance(seller, 'USDT'), 30); // 40 escrow - 10 to buyer
  assert.equal(lockedBalance(seller, 'USDT'), 60); // remaining ad escrow

  const row = db.prepare('SELECT status FROM p2p_orders WHERE order_id = ?').get(order.orderId);
  assert.equal(row.status, 'released');
  const dispute = db.prepare('SELECT status FROM p2p_disputes WHERE order_id = ?').get(order.orderId);
  assert.equal(dispute.status, 'resolved');
});

test('an operator resolution refuses an amount larger than the escrow', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);
  const order = placeOrder({ buyerId: buyer, offerId: created.id, amount: 40, paymentMethod: 'PayPal' });
  advanceOrder(buyer, order.orderId, 'pay');
  advanceOrder(buyer, order.orderId, 'dispute', { reason: 'seller not responding' });

  assert.throws(() => resolveDispute(order.orderId, 41, 'split'), /between 0 and the escrowed amount/);
  // Nothing moved and the dispute is still open.
  assert.equal(availableBalance(buyer, 'USDT'), 0);
  assert.equal(db.prepare('SELECT status FROM p2p_disputes WHERE order_id = ?').get(order.orderId).status, 'open');
});

test('the caller sees the orders they are party to', () => {
  const seller = seedUser();
  const buyer = seedUser();
  fund(seller, 'USDT', 100);
  const created = ad(seller, 100);
  placeOrder({ buyerId: buyer, offerId: created.id, amount: 10, paymentMethod: 'PayPal' });

  const buyerOrders = userOrders(buyer);
  assert.equal(buyerOrders.length, 1);
  assert.equal(buyerOrders[0].role, 'buyer');
  assert.equal(userOrders(seller)[0].role, 'seller');
});

test('a coupon can only be redeemed once, by its owner', () => {
  const owner = seedUser();
  const other = seedUser();
  db.prepare(
    `INSERT INTO coupons (coupon_id, code, user_id, coupon_type, amount, currency)
     VALUES (?, 'WELCOME50', ?, 'cash', 50, 'USDT')`,
  ).run(generateId(), owner);

  assert.equal(userCoupons(owner).length, 1);

  assert.throws(
    () => redeemCoupon(other, 'WELCOME50'),
    (error) => error instanceof RewardsError && error.code === 'COUPON_NOT_YOURS',
  );

  const redeemed = redeemCoupon(owner, 'welcome50');
  assert.equal(redeemed.status, 'used');
  assert.equal(availableBalance(owner, 'USDT'), 50);

  assert.throws(
    () => redeemCoupon(owner, 'WELCOME50'),
    (error) => error instanceof RewardsError && error.code === 'COUPON_USED',
  );
  assert.equal(availableBalance(owner, 'USDT'), 50);
});

test('an unknown coupon code is refused', () => {
  const user = seedUser();
  assert.throws(
    () => redeemCoupon(user, 'NOSUCHCODE'),
    (error) => error instanceof RewardsError && error.code === 'COUPON_NOT_FOUND',
  );
});

test('creating a red packet escrows the full amount', () => {
  const creator = seedUser();
  fund(creator, 'USDT', 100);

  const packet = createRedPacket({
    userId: creator,
    asset: 'USDT',
    amount: 50,
    quantity: 5,
    type: 'average',
    message: 'happy trading',
  });

  assert.equal(packet.remaining, 5);
  assert.equal(availableBalance(creator, 'USDT'), 50);
  assert.equal(lockedBalance(creator, 'USDT'), 50);
});

test('an average red packet pays equal shares and one claim per account', () => {
  const creator = seedUser();
  const claimerA = seedUser();
  const claimerB = seedUser();
  fund(creator, 'USDT', 100);

  const packet = createRedPacket({ userId: creator, asset: 'USDT', amount: 40, quantity: 2, type: 'average' });

  const first = claimRedPacket(claimerA, packet.id);
  assert.equal(first.amount, 20);
  assert.equal(availableBalance(claimerA, 'USDT'), 20);

  assert.throws(
    () => claimRedPacket(claimerA, packet.id),
    (error) => error instanceof RewardsError && error.code === 'ALREADY_CLAIMED',
  );

  const second = claimRedPacket(claimerB, packet.id);
  assert.equal(second.amount, 20);
  // The creator's escrow is fully paid out and nothing is left locked.
  assert.equal(lockedBalance(creator, 'USDT'), 0);
});

test('a random red packet always pays out exactly its funded total', () => {
  const creator = seedUser();
  fund(creator, 'USDT', 100);
  const packet = createRedPacket({ userId: creator, asset: 'USDT', amount: 30, quantity: 10, type: 'random' });

  const claimers = Array.from({ length: 10 }, () => seedUser());
  let paid = 0;
  for (const claimer of claimers) {
    paid += claimRedPacket(claimer, packet.id).amount;
  }

  // Every unit of the packet is distributed and no more. Amounts are stored as
  // SQLite REALs, so the residual is compared with the same relative tolerance
  // the ledger uses rather than bit-exact zero.
  assert.ok(Math.abs(paid - 30) < 1e-9, `paid ${paid} should be 30`);
  assert.ok(lockedBalance(creator, 'USDT') < 1e-9, 'the escrow should be empty');
});

test('a fully claimed packet is closed', () => {
  const creator = seedUser();
  const claimer = seedUser();
  fund(creator, 'USDT', 100);
  const packet = createRedPacket({ userId: creator, asset: 'USDT', amount: 5, quantity: 1, type: 'average' });

  claimRedPacket(claimer, packet.id);
  assert.throws(
    () => claimRedPacket(seedUser(), packet.id),
    (error) => error instanceof RewardsError && error.code === 'PACKET_INACTIVE',
  );
});

test('only the creator can refund their own expired packet', () => {
  const creator = seedUser();
  const other = seedUser();
  fund(creator, 'USDT', 100);
  const packet = createRedPacket({
    userId: creator,
    asset: 'USDT',
    amount: 20,
    quantity: 4,
    type: 'average',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });

  assert.throws(
    () => refundRedPacket(other, packet.id),
    (error) => error instanceof RewardsError && error.code === 'FORBIDDEN',
  );

  const result = refundRedPacket(creator, packet.id);
  assert.equal(result.refunded, 20);
  assert.equal(availableBalance(creator, 'USDT'), 100);
});

test('a packet that has not expired cannot be refunded', () => {
  const creator = seedUser();
  fund(creator, 'USDT', 100);
  const packet = createRedPacket({
    userId: creator,
    asset: 'USDT',
    amount: 20,
    quantity: 4,
    type: 'average',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  assert.throws(
    () => refundRedPacket(creator, packet.id),
    (error) => error instanceof RewardsError && error.code === 'NOT_EXPIRED',
  );
});

test('the scheduled sweep refunds expired packets without a caller', () => {
  const creator = seedUser();
  fund(creator, 'USDT', 100);
  createRedPacket({
    userId: creator,
    asset: 'USDT',
    amount: 30,
    quantity: 3,
    type: 'average',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  // A live packet must be left alone.
  createRedPacket({
    userId: creator,
    asset: 'USDT',
    amount: 20,
    quantity: 2,
    type: 'average',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  assert.equal(availableBalance(creator, 'USDT'), 50);
  const swept = sweepExpiredRedPackets();
  assert.equal(swept, 1);
  // Only the expired packet's escrow is released; the live one stays locked.
  assert.equal(availableBalance(creator, 'USDT'), 80);
  assert.equal(lockedBalance(creator, 'USDT'), 20);
  // A second sweep is a no-op, so the escrow cannot be released twice.
  assert.equal(sweepExpiredRedPackets(), 0);
  assert.equal(availableBalance(creator, 'USDT'), 80);
});

test('staking pools report the real total staked', () => {
  db.prepare(
    `INSERT INTO earn_products (product_id, name, product_type, asset, apy, duration_days, min_amount)
     VALUES ('p1', 'RUSD 90 day', 'locked', 'RUSD', 0.15, 90, 10)`,
  ).run();

  const user = seedUser();
  db.prepare(
    `INSERT INTO earn_subscriptions (subscription_id, user_id, product_id, amount, status)
     VALUES (?, ?, 'p1', 250, 'active')`,
  ).run(generateId(), user);

  const pool = stakingPools().find((entry) => entry.id === 'p1');
  assert.ok(pool);
  assert.equal(pool.asset, 'RUSD');
  assert.equal(pool.lockDays, 90);
  assert.equal(pool.totalStaked, 250);
});
