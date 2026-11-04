/**
 * Staking pools, flexible earn products, coupons and red packets.
 *
 * All four are the exchange's own products. A subscription locks the principal
 * in the ledger; a redemption returns it. A coupon is a single-use code that
 * credits a fixed amount; a red packet splits a funded pool between claimers,
 * and the pool is escrowed when it is created so it can always pay out.
 *
 * The reward maths for flexible and locked products lives in the earn engine
 * (`accrueSimple`, `lockedRedeemable`); this module only moves funds.
 */

import { getDb, generateId } from '@/lib/db';
import { lockAvailable, unlockAvailable, creditAvailable, consumeLocked, recordTransaction } from '@/lib/db/ledger';

export class RewardsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Staking pools
// ---------------------------------------------------------------------------

export interface StakingPool {
  id: string;
  name: string;
  asset: string;
  apy: number;
  lockDays: number | null;
  minAmount: number;
  cap: number | null;
  totalStaked: number;
  status: string;
}

function poolRowToPool(row: Record<string, unknown>, staked: number): StakingPool {
  return {
    id: String(row.product_id),
    name: String(row.name),
    asset: String(row.asset),
    apy: Number(row.apy) || 0,
    lockDays: row.duration_days === null || row.duration_days === undefined ? null : Number(row.duration_days),
    minAmount: Number(row.min_amount) || 0,
    cap: row.cap === null || row.cap === undefined ? null : Number(row.cap),
    totalStaked: staked,
    status: String(row.status),
  };
}

/** Active staking pools with their real total staked. */
export function stakingPools(): StakingPool[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM earn_products WHERE status = 'active' ORDER BY product_type, asset")
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const total = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM earn_subscriptions WHERE product_id = ? AND status = 'active'")
      .get(String(row.product_id)) as { total: number } | undefined;
    return poolRowToPool(row, Number(total?.total) || 0);
  });
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export interface Coupon {
  id: string;
  code: string;
  type: string;
  amount: number;
  currency: string;
  minRequirement: number;
  expiresAt: string | null;
  usedAt: string | null;
  status: string;
}

function couponRow(row: Record<string, unknown>): Coupon {
  return {
    id: String(row.coupon_id),
    code: String(row.code),
    type: String(row.coupon_type),
    amount: Number(row.amount) || 0,
    currency: String(row.currency),
    minRequirement: Number(row.min_requirement) || 0,
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
    usedAt: row.used_at === null || row.used_at === undefined ? null : String(row.used_at),
    status: String(row.status),
  };
}

/** The caller's coupons, newest first. */
export function userCoupons(userId: string): Coupon[] {
  const rows = getDb()
    .prepare('SELECT * FROM coupons WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map(couponRow);
}

/**
 * Redeem a coupon code for the caller.
 *
 * The code must exist, belong to the caller, be unused and unexpired. The
 * credit and the single-use mark happen in one transaction, so a code cannot be
 * redeemed twice even by concurrent requests.
 */
export function redeemCoupon(userId: string, code: string): Coupon {
  const value = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,64}$/.test(value)) {
    throw new RewardsError('VALIDATION_FAILED', 'A valid coupon code is required');
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM coupons WHERE code = ?').get(value) as Record<string, unknown> | undefined;
  if (!row) throw new RewardsError('COUPON_NOT_FOUND', 'No such coupon code', 404);

  const coupon = couponRow(row);
  if (String(row.user_id) !== userId) {
    throw new RewardsError('COUPON_NOT_YOURS', 'This coupon was not issued to your account', 403);
  }
  if (coupon.usedAt !== null || coupon.status === 'used') {
    throw new RewardsError('COUPON_USED', 'This coupon has already been redeemed', 409);
  }
  if (coupon.expiresAt !== null && Date.parse(coupon.expiresAt) < Date.now()) {
    throw new RewardsError('COUPON_EXPIRED', 'This coupon has expired', 409);
  }

  db.transaction(() => {
    creditAvailable(userId, coupon.currency, coupon.amount);
    recordTransaction(userId, 'coupon', coupon.currency, coupon.amount, 0, 'completed', `Coupon ${coupon.code}`);
    db.prepare("UPDATE coupons SET used_at = datetime('now'), status = 'used' WHERE coupon_id = ?").run(coupon.id);
  })();

  return { ...coupon, usedAt: new Date().toISOString(), status: 'used' };
}

// ---------------------------------------------------------------------------
// Red packets
// ---------------------------------------------------------------------------

export interface RedPacket {
  id: string;
  creatorId: string;
  asset: string;
  amount: number;
  quantity: number;
  type: string;
  claimed: number;
  remaining: number;
  status: string;
  message: string | null;
  expiresAt: string | null;
}

function packetRow(row: Record<string, unknown>): RedPacket {
  const quantity = Number(row.quantity) || 0;
  const claimedCount = Number(row.claimed_count) || 0;
  return {
    id: String(row.packet_id),
    creatorId: String(row.creator_id),
    asset: String(row.asset),
    amount: Number(row.amount) || 0,
    quantity,
    type: String(row.packet_type),
    claimed: claimedCount,
    remaining: Math.max(0, quantity - claimedCount),
    status: String(row.status),
    message: row.message === null || row.message === undefined ? null : String(row.message),
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
  };
}

/** The caller's own red packets, newest first. */
export function userRedPackets(userId: string): RedPacket[] {
  const rows = getDb()
    .prepare('SELECT * FROM red_packets WHERE creator_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map(packetRow);
}

export interface CreateRedPacketInput {
  userId: string;
  asset: string;
  amount: number;
  quantity: number;
  type: 'random' | 'average';
  message?: string | null;
  expiresAt?: string | null;
}

/**
 * Create a red packet.
 *
 * The full amount is escrowed from the creator immediately, so every packet a
 * claimer can find is backed by funds the exchange already holds.
 */
export function createRedPacket(input: CreateRedPacketInput): RedPacket {
  const asset = String(input.asset ?? '').trim().toUpperCase();
  const amount = Number(input.amount);
  const quantity = Math.trunc(Number(input.quantity));
  const type = input.type === 'average' ? 'average' : 'random';

  if (!asset) throw new RewardsError('VALIDATION_FAILED', 'An asset is required');
  if (!Number.isFinite(amount) || amount <= 0) throw new RewardsError('INVALID_AMOUNT', 'Amount must be positive');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    throw new RewardsError('VALIDATION_FAILED', 'Quantity must be an integer between 1 and 1000');
  }
  // Each share must be at least one unit of the asset's precision, otherwise a
  // share would round to zero and a claimer would receive nothing.
  if (Math.round(amount * 1e8) < quantity) {
    throw new RewardsError('VALIDATION_FAILED', 'The amount must be at least one unit per share');
  }

  const db = getDb();
  const packetId = generateId();

  db.transaction(() => {
    lockAvailable(input.userId, asset, amount);
    db.prepare(
      `INSERT INTO red_packets (packet_id, creator_id, asset, amount, quantity, packet_type, message, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    ).run(
      packetId,
      input.userId,
      asset,
      amount,
      quantity,
      type,
      input.message ? String(input.message).slice(0, 200) : null,
      input.expiresAt ?? null,
    );
  })();

  const created = db.prepare('SELECT * FROM red_packets WHERE packet_id = ?').get(packetId) as Record<string, unknown>;
  return packetRow(created);
}

/**
 * Claim a share of a red packet.
 *
 * An `average` packet pays an equal share. A `random` packet draws from the
 * remaining balance with a bound that leaves at least one unit for every
 * remaining claimer, which is the standard fair-split rule and guarantees the
 * last claimer still receives something.
 */
export function claimRedPacket(userId: string, packetId: string): { amount: number } {
  const id = String(packetId ?? '').trim();
  if (!id) throw new RewardsError('VALIDATION_FAILED', 'A red packet id is required');

  const db = getDb();
  const row = db.prepare('SELECT * FROM red_packets WHERE packet_id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new RewardsError('PACKET_NOT_FOUND', 'No such red packet', 404);

  const packet = packetRow(row);
  if (packet.status !== 'active') throw new RewardsError('PACKET_INACTIVE', 'This red packet is no longer active', 409);
  if (packet.expiresAt !== null && Date.parse(packet.expiresAt) < Date.now()) {
    throw new RewardsError('PACKET_EXPIRED', 'This red packet has expired', 409);
  }
  if (packet.remaining <= 0) throw new RewardsError('PACKET_EMPTY', 'This red packet has been fully claimed', 409);

  const already = db
    .prepare('SELECT 1 FROM red_packet_claims WHERE packet_id = ? AND user_id = ?')
    .get(id, userId);
  if (already) throw new RewardsError('ALREADY_CLAIMED', 'You have already claimed this red packet', 409);

  const claimedAmount = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM red_packet_claims WHERE packet_id = ?')
    .get(id) as { total: number } | undefined;
  const paidOut = Number(claimedAmount?.total) || 0;

  // Shares are drawn in integer units of 1e-8, the exchange's asset precision,
  // so the amounts always add up to exactly the funded total with no dust left
  // over and no share rounding to zero.
  const UNIT = 1e8;
  const remainingUnits = Math.round(packet.amount * UNIT) - Math.round(paidOut * UNIT);
  const sharesLeft = packet.remaining;

  let shareUnits: number;
  if (packet.type === 'average' || sharesLeft === 1) {
    shareUnits = Math.floor(remainingUnits / sharesLeft);
  } else {
    // Bound the draw so at least one unit is left for every remaining claimer.
    const maxShareUnits = remainingUnits - (sharesLeft - 1);
    const fairUnits = Math.floor((remainingUnits / sharesLeft) * 2);
    const bound = Math.max(1, Math.min(maxShareUnits, fairUnits));
    shareUnits = 1 + Math.floor(Math.random() * bound);
    if (shareUnits > maxShareUnits) shareUnits = maxShareUnits;
  }
  shareUnits = Math.max(1, Math.min(shareUnits, remainingUnits));
  const share = shareUnits / UNIT;

  db.transaction(() => {
    consumeLocked(packet.creatorId, packet.asset, share);
    creditAvailable(userId, packet.asset, share);
    db.prepare(
      'INSERT INTO red_packet_claims (claim_id, packet_id, user_id, amount) VALUES (?, ?, ?, ?)',
    ).run(generateId(), id, userId, share);
    recordTransaction(userId, 'red_packet', packet.asset, share, 0, 'completed', `Red packet ${id}`);

    const nowClaimed = packet.claimed + 1;
    if (nowClaimed >= packet.quantity) {
      db.prepare("UPDATE red_packets SET claimed_count = ?, status = 'completed' WHERE packet_id = ?").run(nowClaimed, id);
    } else {
      db.prepare('UPDATE red_packets SET claimed_count = ? WHERE packet_id = ?').run(nowClaimed, id);
    }
  })();

  return { amount: share };
}

/** Refund the unclaimed balance of an expired packet to its creator. */
export function refundRedPacket(creatorId: string, packetId: string): { refunded: number } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM red_packets WHERE packet_id = ?').get(packetId) as Record<string, unknown> | undefined;
  if (!row) throw new RewardsError('PACKET_NOT_FOUND', 'No such red packet', 404);

  const packet = packetRow(row);
  if (packet.creatorId !== creatorId) throw new RewardsError('FORBIDDEN', 'This packet belongs to another account', 403);
  if (packet.status !== 'active') throw new RewardsError('PACKET_INACTIVE', 'This red packet is not active', 409);
  if (packet.expiresAt !== null && Date.parse(packet.expiresAt) >= Date.now()) {
    throw new RewardsError('NOT_EXPIRED', 'This red packet has not expired yet', 409);
  }

  const claimedAmount = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM red_packet_claims WHERE packet_id = ?')
    .get(packetId) as { total: number } | undefined;
  const refunded = Math.max(0, packet.amount - (Number(claimedAmount?.total) || 0));

  db.transaction(() => {
    if (refunded > 0) unlockAvailable(creatorId, packet.asset, refunded);
    db.prepare("UPDATE red_packets SET status = 'expired' WHERE packet_id = ?").run(packetId);
  })();

  return { refunded };
}
