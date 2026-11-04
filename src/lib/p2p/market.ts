/**
 * P2P marketplace.
 *
 * A P2P trade escrows the seller's asset before the buyer pays fiat, and the
 * asset is released only after the buyer marks the payment as sent. Every
 * movement goes through the balance ledger inside one database transaction, so
 * a dispute cannot leave the asset released to both sides or to neither.
 *
 * Ads and orders are the exchange's own rows; there is no third-party
 * marketplace involved.
 */

import { getDb, generateId } from '@/lib/db';
import { lockAvailable, unlockAvailable, consumeLocked, creditAvailable, recordTransaction } from '@/lib/db/ledger';
import { transition, type P2pStatus } from '@/lib/p2p/escrow';

export class P2pError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface P2pAd {
  id: string;
  userId: string;
  side: 'buy' | 'sell';
  asset: string;
  fiatCurrency: string;
  price: number;
  minAmount: number;
  maxAmount: number;
  available: number;
  paymentMethods: string[];
  status: string;
  createdAt: string;
}

function parseMethods(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value));
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

/** Active ads, optionally filtered by asset, fiat and side. */
export function listAds(filter: { asset?: string; fiat?: string; side?: string; limit?: number } = {}): P2pAd[] {
  const clauses = ["status = 'active'", 'available > 0'];
  const params: Array<string | number> = [];

  if (filter.asset) {
    clauses.push('UPPER(asset) = ?');
    params.push(filter.asset.trim().toUpperCase());
  }
  if (filter.fiat) {
    clauses.push('UPPER(fiat) = ?');
    params.push(filter.fiat.trim().toUpperCase());
  }
  if (filter.side) {
    clauses.push('side = ?');
    params.push(filter.side.trim().toLowerCase());
  }
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 200) || 200, 1), 500);

  const rows = getDb()
    .prepare(
      `SELECT offer_id, user_id, side, asset, fiat, price, min_amount, max_amount, available,
              payment_methods, status, created_at
         FROM p2p_offers
        WHERE ${clauses.join(' AND ')}
        ORDER BY price, created_at DESC
        LIMIT ?`,
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.offer_id),
    userId: String(row.user_id),
    side: String(row.side) as 'buy' | 'sell',
    asset: String(row.asset),
    fiatCurrency: String(row.fiat),
    price: Number(row.price) || 0,
    minAmount: Number(row.min_amount) || 0,
    maxAmount: Number(row.max_amount) || 0,
    available: Number(row.available) || 0,
    paymentMethods: parseMethods(row.payment_methods),
    status: String(row.status),
    createdAt: String(row.created_at),
  }));
}

/** The distinct fiat payment methods offered by active ads. */
export function paymentMethods(): string[] {
  const rows = getDb()
    .prepare("SELECT payment_methods FROM p2p_offers WHERE status = 'active'")
    .all() as Array<{ payment_methods: unknown }>;

  const methods = new Set<string>();
  for (const row of rows) {
    for (const method of parseMethods(row.payment_methods)) methods.add(method);
  }
  return Array.from(methods).sort();
}

export interface CreateAdInput {
  userId: string;
  side: 'buy' | 'sell';
  asset: string;
  fiat: string;
  price: number;
  minAmount: number;
  maxAmount: number;
  available: number;
  paymentMethods: string[];
}

/**
 * Create an ad.
 *
 * A sell ad escrows the advertised quantity, so the seller cannot spend the
 * same funds elsewhere while the ad is live. A buy ad escrows nothing because
 * the advertiser is the one paying fiat.
 */
export function createAd(input: CreateAdInput): P2pAd {
  const side = String(input.side).toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    throw new P2pError('VALIDATION_FAILED', 'side must be buy or sell');
  }

  const asset = String(input.asset ?? '').trim().toUpperCase();
  const fiat = String(input.fiat ?? '').trim().toUpperCase();
  if (!asset || !fiat) throw new P2pError('VALIDATION_FAILED', 'An asset and a fiat currency are required');

  const price = Number(input.price);
  const minAmount = Number(input.minAmount);
  const maxAmount = Number(input.maxAmount);
  const available = Number(input.available);

  if (!Number.isFinite(price) || price <= 0) throw new P2pError('VALIDATION_FAILED', 'Price must be positive');
  if (!Number.isFinite(minAmount) || minAmount <= 0) throw new P2pError('VALIDATION_FAILED', 'Minimum amount must be positive');
  if (!Number.isFinite(maxAmount) || maxAmount < minAmount) {
    throw new P2pError('VALIDATION_FAILED', 'Maximum amount must be at least the minimum');
  }
  if (!Number.isFinite(available) || available < minAmount) {
    throw new P2pError('VALIDATION_FAILED', 'Available amount must be at least the minimum');
  }
  if (!Array.isArray(input.paymentMethods) || input.paymentMethods.length === 0) {
    throw new P2pError('VALIDATION_FAILED', 'At least one payment method is required');
  }

  const db = getDb();
  const offerId = generateId();

  db.transaction(() => {
    if (side === 'sell') lockAvailable(input.userId, asset, available);
    db.prepare(
      `INSERT INTO p2p_offers
         (offer_id, user_id, side, asset, fiat, price, min_amount, max_amount, available, payment_methods, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    ).run(
      offerId,
      input.userId,
      side,
      asset,
      fiat,
      price,
      minAmount,
      maxAmount,
      available,
      JSON.stringify(input.paymentMethods.map((method) => String(method).slice(0, 64))),
    );
  })();

  const ad = listAds({ asset, fiat, limit: 500 }).find((entry) => entry.id === offerId);
  if (!ad) throw new P2pError('INTERNAL_ERROR', 'The ad could not be created', 500);
  return ad;
}

/** Close an ad, releasing any escrow the seller still holds. */
export function closeAd(userId: string, offerId: string): void {
  const db = getDb();
  const ad = db
    .prepare('SELECT offer_id, user_id, side, asset, available, status FROM p2p_offers WHERE offer_id = ?')
    .get(offerId) as
    | { offer_id: string; user_id: string; side: string; asset: string; available: number; status: string }
    | undefined;

  if (!ad) throw new P2pError('NOT_FOUND', 'No such ad', 404);
  if (ad.user_id !== userId) throw new P2pError('FORBIDDEN', 'This ad belongs to another account', 403);
  if (ad.status !== 'active') throw new P2pError('ALREADY_CLOSED', 'This ad is not active', 409);

  db.transaction(() => {
    const remaining = Number(ad.available) || 0;
    if (ad.side === 'sell' && remaining > 0) unlockAvailable(userId, ad.asset, remaining);
    db.prepare("UPDATE p2p_offers SET status = 'closed', available = 0 WHERE offer_id = ?").run(offerId);
  })();
}

export interface PlaceP2pOrderInput {
  buyerId: string;
  offerId: string;
  amount: number;
  paymentMethod: string;
}

export interface P2pOrder {
  orderId: string;
  offerId: string;
  buyerId: string;
  sellerId: string;
  asset: string;
  fiat: string;
  price: number;
  amount: number;
  escrowAmount: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
}

/**
 * Place an order against an ad.
 *
 * Buying from a sell ad escrows the seller's asset for the duration of the
 * trade; selling into a buy ad escrows the taker's asset instead, so whichever
 * side delivers crypto has it reserved before fiat changes hands.
 */
export function placeOrder(input: PlaceP2pOrderInput): P2pOrder {
  const db = getDb();
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new P2pError('INVALID_AMOUNT', 'Amount must be positive');

  const ad = db
    .prepare(
      `SELECT offer_id, user_id, side, asset, fiat, price, min_amount, max_amount, available, status
         FROM p2p_offers WHERE offer_id = ?`,
    )
    .get(input.offerId) as
    | {
        offer_id: string;
        user_id: string;
        side: string;
        asset: string;
        fiat: string;
        price: number;
        min_amount: number;
        max_amount: number;
        available: number;
        status: string;
      }
    | undefined;

  if (!ad) throw new P2pError('NOT_FOUND', 'No such ad', 404);
  if (ad.status !== 'active') throw new P2pError('AD_NOT_ACTIVE', 'This ad is not active', 409);
  if (ad.user_id === input.buyerId) throw new P2pError('SELF_TRADE', 'You cannot trade against your own ad');
  if (amount < Number(ad.min_amount) || amount > Number(ad.max_amount)) {
    throw new P2pError('OUT_OF_LIMITS', `Amount must be between ${ad.min_amount} and ${ad.max_amount}`);
  }
  if (amount > Number(ad.available)) {
    throw new P2pError('INSUFFICIENT_AVAILABLE', 'The ad does not have that much available');
  }

  const paymentMethod = String(input.paymentMethod ?? '').trim();
  const methods = parseMethods(
    (db.prepare('SELECT payment_methods FROM p2p_offers WHERE offer_id = ?').get(input.offerId) as {
      payment_methods: unknown;
    }).payment_methods,
  );
  if (!paymentMethod || !methods.includes(paymentMethod)) {
    throw new P2pError('VALIDATION_FAILED', 'The selected payment method is not offered by this ad');
  }

  // The crypto side of the trade is always the seller; the advertiser is the
  // seller on a sell ad, and the taker is the seller on a buy ad.
  const sellerId = ad.side === 'sell' ? ad.user_id : input.buyerId;
  const buyerId = ad.side === 'sell' ? input.buyerId : ad.user_id;
  const orderId = generateId();

  db.transaction(() => {
    // On a sell ad the advertiser's crypto was escrowed when the ad was
    // created, so the order reuses that escrow instead of locking it twice.
    // On a buy ad the advertiser pays fiat and the taker delivers crypto, so
    // the taker's funds are locked here.
    if (ad.side === 'buy') lockAvailable(sellerId, ad.asset, amount);
    db.prepare('UPDATE p2p_offers SET available = available - ? WHERE offer_id = ?').run(amount, input.offerId);
    db.prepare(
      `INSERT INTO p2p_orders
         (order_id, offer_id, buyer_id, seller_id, asset, fiat, price, amount, escrow_amount, payment_method, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      orderId,
      input.offerId,
      buyerId,
      sellerId,
      ad.asset,
      ad.fiat,
      Number(ad.price),
      amount,
      amount,
      paymentMethod,
    );
  })();

  return {
    orderId,
    offerId: input.offerId,
    buyerId,
    sellerId,
    asset: ad.asset,
    fiat: ad.fiat,
    price: Number(ad.price),
    amount,
    escrowAmount: amount,
    paymentMethod,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

function loadOrder(orderId: string) {
  const order = getDb()
    .prepare(
      `SELECT order_id, offer_id, buyer_id, seller_id, asset, fiat, price, amount, escrow_amount,
              payment_method, status, created_at
         FROM p2p_orders WHERE order_id = ?`,
    )
    .get(orderId) as
    | {
        order_id: string;
        offer_id: string;
        buyer_id: string;
        seller_id: string;
        asset: string;
        fiat: string;
        price: number;
        amount: number;
        escrow_amount: number;
        payment_method: string;
        status: string;
        created_at: string;
      }
    | undefined;
  if (!order) throw new P2pError('NOT_FOUND', 'No such P2P order', 404);
  return order;
}

/**
 * Move a P2P order through its state machine.
 *
 * The allowed transitions come from the escrow module, so an illegal move (for
 * example releasing before payment) is refused here and by the tested state
 * machine. `release` hands the escrowed asset to the buyer; `cancel` returns it
 * to the seller; `resolve` splits a dispute as the operator decided.
 */
export function advanceOrder(
  actorId: string,
  orderId: string,
  event: 'pay' | 'release' | 'cancel' | 'dispute' | 'resolve',
  options: { splitToBuyer?: number; reason?: string } = {},
): { status: string } {
  const db = getDb();
  const order = loadOrder(orderId);

  const isBuyer = order.buyer_id === actorId;
  const isSeller = order.seller_id === actorId;
  if (!isBuyer && !isSeller) throw new P2pError('FORBIDDEN', 'You are not a party to this order', 403);

  if (event === 'pay' && !isBuyer) {
    throw new P2pError('FORBIDDEN', 'Only the buyer can mark the payment as sent', 403);
  }
  if (event === 'release' && !isSeller) {
    throw new P2pError('FORBIDDEN', 'Only the seller can release the escrow', 403);
  }

  const next = transition(order.status as P2pStatus, event);
  if ('error' in next) throw new P2pError('ILLEGAL_TRANSITION', next.error);

  const amount = Number(order.escrow_amount) || 0;

  // On a sell ad the crypto was locked when the ad was created and the order
  // only reserved part of it, so cancelling must keep it locked for the ad. On
  // a buy ad the taker's crypto was locked when the order was placed, so
  // cancelling releases it.
  const offer = db.prepare('SELECT side FROM p2p_offers WHERE offer_id = ?').get(order.offer_id) as
    | { side: string }
    | undefined;
  const sellerLockedAtAdCreation = offer?.side === 'sell';

  db.transaction(() => {
    if (event === 'release') {
      consumeLocked(order.seller_id, order.asset, amount);
      creditAvailable(order.buyer_id, order.asset, amount);
      recordTransaction(order.seller_id, 'p2p_sell', order.asset, amount, 0, 'completed', `P2P ${orderId}`);
      recordTransaction(order.buyer_id, 'p2p_buy', order.asset, amount, 0, 'completed', `P2P ${orderId}`);
      db.prepare("UPDATE p2p_orders SET status = 'released', released_at = ? WHERE order_id = ?").run(
        new Date().toISOString(),
        orderId,
      );
      return;
    }

    if (event === 'cancel') {
      if (!sellerLockedAtAdCreation) unlockAvailable(order.seller_id, order.asset, amount);
      db.prepare("UPDATE p2p_orders SET status = 'cancelled' WHERE order_id = ?").run(orderId);
      db.prepare('UPDATE p2p_offers SET available = available + ? WHERE offer_id = ?').run(amount, order.offer_id);
      return;
    }

    if (event === 'resolve') {
      const toBuyer = Number(options.splitToBuyer);
      if (!Number.isFinite(toBuyer) || toBuyer < 0 || toBuyer > amount) {
        throw new P2pError('VALIDATION_FAILED', 'splitToBuyer must be between 0 and the escrowed amount');
      }
      consumeLocked(order.seller_id, order.asset, amount);
      if (toBuyer > 0) creditAvailable(order.buyer_id, order.asset, toBuyer);
      if (amount - toBuyer > 0) creditAvailable(order.seller_id, order.asset, amount - toBuyer);
      db.prepare("UPDATE p2p_orders SET status = 'released', released_at = ? WHERE order_id = ?").run(
        new Date().toISOString(),
        orderId,
      );
      db.prepare("UPDATE p2p_disputes SET status = 'resolved', resolution = ? WHERE order_id = ? AND status = 'open'").run(
        options.reason ?? 'resolved by operator',
        orderId,
      );
      return;
    }

    db.prepare('UPDATE p2p_orders SET status = ? WHERE order_id = ?').run(next.status, orderId);
    if (event === 'dispute') {
      db.prepare(
        `INSERT INTO p2p_disputes (dispute_id, order_id, opened_by, reason, status)
         VALUES (?, ?, ?, ?, 'open')`,
      ).run(generateId(), orderId, actorId, String(options.reason ?? 'dispute').slice(0, 500));
    }
  })();

  return { status: event === 'resolve' || event === 'release' ? 'released' : next.status };
}

/** The caller's P2P orders, newest first. */
export function userOrders(userId: string, limit = 100): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare(
      `SELECT order_id, offer_id, buyer_id, seller_id, asset, fiat, price, amount, escrow_amount,
              payment_method, status, created_at, released_at
         FROM p2p_orders
        WHERE buyer_id = ? OR seller_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(userId, userId, Math.min(Math.max(Math.trunc(limit) || 100, 1), 500)) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.order_id,
    orderId: row.order_id,
    offerId: row.offer_id,
    role: row.buyer_id === userId ? 'buyer' : 'seller',
    asset: row.asset,
    fiatCurrency: row.fiat,
    price: Number(row.price) || 0,
    amount: Number(row.amount) || 0,
    fiatAmount: (Number(row.price) || 0) * (Number(row.amount) || 0),
    paymentMethod: row.payment_method,
    status: row.status,
    createdAt: row.created_at,
    releasedAt: row.released_at ?? null,
  }));
}

/** The caller's own ads, newest first. */
export function userAds(userId: string, limit = 100): P2pAd[] {
  const rows = getDb()
    .prepare(
      `SELECT offer_id, user_id, side, asset, fiat, price, min_amount, max_amount, available,
              payment_methods, status, created_at
         FROM p2p_offers
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(userId, Math.min(Math.max(Math.trunc(limit) || 100, 1), 500)) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.offer_id),
    userId: String(row.user_id),
    side: String(row.side) as 'buy' | 'sell',
    asset: String(row.asset),
    fiatCurrency: String(row.fiat),
    price: Number(row.price) || 0,
    minAmount: Number(row.min_amount) || 0,
    maxAmount: Number(row.max_amount) || 0,
    available: Number(row.available) || 0,
    paymentMethods: parseMethods(row.payment_methods),
    status: String(row.status),
    createdAt: String(row.created_at),
  }));
}
