/**
 * TigerSwap MEV settlement.
 *
 * The pure rules live in `mev.ts`: how attractive a pending order is to a
 * sandwich attacker, whether a block contains a sandwich, and how a private
 * batch is ordered. This module is the settlement half. It prices a pending
 * swap against the venue's own pools to get the real impact, records a private
 * order as a commitment in `dex_private_orders`, and reconstructs a sandwich
 * from the swaps the venue actually settled.
 *
 * Nothing here talks to another exchange or a third-party relay: the private
 * path is TigerSwap's own table and its own ordering rule.
 */

import { getDb, generateId } from '@/lib/db';
import { DexError, dexSetting, dexSettingBool, assertDexOpen } from '@/lib/dex/pool-service';
import { quoteSwap, executeSwap } from '@/lib/dex/swap-service';
import {
  scoreImpact,
  detectSandwich,
  commitmentFor,
  orderPrivateFlow,
  type MevRisk,
  type SwapObservation,
  type SandwichDetection,
} from '@/lib/dex/mev';

export interface MevAssessment extends MevRisk {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  /** Whether the private path is currently enabled by the operator. */
  protectionEnabled: boolean;
}

/**
 * Score a pending swap against the venue's real pools.
 *
 * The impact is the one the router would actually charge — the pool's own spot
 * price against the execution price — so the score reflects the trade the venue
 * would settle, not a model of it. A swap on a paused venue or one with no route
 * throws rather than reporting a false "safe" verdict.
 */
export function assessSwapRisk(request: {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippage?: number | string;
}): MevAssessment {
  const quote = quoteSwap(request);
  const threshold = dexSetting('dex_mev_protect_threshold', 0.005);
  const risk = scoreImpact(quote.priceImpact, quote.slippage, threshold);
  return {
    ...risk,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    protectionEnabled: dexSettingBool('dex_mev_protection_enabled', true),
  };
}

export interface PrivateOrder {
  orderId: string;
  batchId: string;
  commitment: string;
  sequence: number;
  status: string;
}

interface PrivateOrderRow {
  order_id: string;
  batch_id: string;
  user_id: string;
  token_in: string;
  token_out: string;
  amount_in: number;
  commitment: string;
  sequence: number;
  committed_at: number;
  status: string;
}

/**
 * The batch an order arriving now belongs to.
 *
 * Batching by a fixed time window, rather than by arrival, is what makes the
 * ordering fair: every order in the same window is committed before any is
 * revealed, so no participant can be jumped by one that arrived later.
 */
export function batchIdFor(now: number, windowSeconds: number): string {
  if (!Number.isFinite(now) || now < 0) {
    throw new DexError('INVALID_TIME', 'now must be a non-negative finite number', 400);
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new DexError('INVALID_WINDOW', 'windowSeconds must be positive', 400);
  }
  return `batch-${Math.floor(now / (windowSeconds * 1000))}`;
}

/**
 * Submit a swap to the private path.
 *
 * The row stores a commitment, not the plaintext, so a searcher reading the
 * pending set learns nothing about the order. The sequence is assigned at commit
 * time and never changes, which is the property the anti-front-running guarantee
 * rests on: to move ahead of an order a searcher would have had to commit
 * earlier, and they could not know to.
 */
export function submitPrivateOrder(request: {
  userId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  windowSeconds?: number;
}): PrivateOrder {
  assertDexOpen('dex');
  if (!dexSettingBool('dex_mev_protection_enabled', true)) {
    throw new DexError('MEV_DISABLED', 'private order flow is disabled', 409);
  }

  // Price the order first: an order that cannot be priced must not enter the
  // private set, or the reveal step would fail after the commitment was public.
  const quote = quoteSwap({
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
  });

  const windowSeconds = request.windowSeconds ?? 12;
  const now = Date.now();
  const batchId = batchIdFor(now, windowSeconds);
  const db = getDb();

  return db.transaction(() => {
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM dex_private_orders WHERE batch_id = ?')
      .get(batchId) as { c: number };
    const sequence = count.c;
    const orderId = generateId();
    const commitment = commitmentFor(orderId, batchId);

    db.prepare(
      `INSERT INTO dex_private_orders
         (order_id, batch_id, user_id, token_in, token_out, amount_in, commitment, sequence, committed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed')`,
    ).run(
      orderId,
      batchId,
      request.userId,
      quote.tokenIn,
      quote.tokenOut,
      quote.amountIn,
      commitment,
      sequence,
      now,
    );

    return { orderId, batchId, commitment, sequence, status: 'committed' };
  })();
}

export interface BatchView {
  batchId: string;
  entries: Array<{
    orderId: string;
    userId: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    commitment: string;
    sequence: number;
    status: string;
  }>;
}

export interface BatchSettlement {
  batchId: string;
  settled: number;
  failed: number;
  results: Array<{
    orderId: string;
    status: 'settled' | 'failed';
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    amountOut?: number;
    reason?: string;
  }>;
}

/** The committed orders of a batch, in the order they will be revealed. */
export function privateBatch(batchId: string): BatchView {
  const rows = getDb()
    .prepare('SELECT * FROM dex_private_orders WHERE batch_id = ? ORDER BY sequence ASC')
    .all(batchId) as PrivateOrderRow[];
  return {
    batchId,
    entries: rows.map((row) => ({
      orderId: row.order_id,
      userId: row.user_id,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      amountIn: row.amount_in,
      commitment: row.commitment,
      sequence: row.sequence,
      status: row.status,
    })),
  };
}

/**
 * Reveal a batch so its orders can settle.
 *
 * The reveal order is fixed by the commit order through the pure ordering rule,
 * so a node cannot reorder a batch to favour a payer. Every row in the batch is
 * marked revealed in one transaction; a partially revealed batch would let a
 * searcher see some amounts while others stay hidden.
 */
export function revealBatch(batchId: string): BatchView {
  assertDexOpen('dex');
  const db = getDb();
  const rows = db
    .prepare("SELECT order_id, committed_at FROM dex_private_orders WHERE batch_id = ? AND status = 'committed'")
    .all(batchId) as Array<{ order_id: string; committed_at: number }>;
  if (rows.length === 0) throw new DexError('UNKNOWN_BATCH', `batch ${batchId} has no committed orders`, 404);

  // The ordering rule is applied here as the authority, not merely for display.
  const plan = orderPrivateFlow(
    rows.map((row) => ({ orderId: row.order_id, committedAt: row.committed_at })),
    batchId,
  );

  // Only committed rows are revealed. Re-revealing a batch must not drag a
  // settled order back into the settleable set, or the same private order would
  // trade twice.
  db.transaction(() => {
    const update = db.prepare(
      "UPDATE dex_private_orders SET status = 'revealed', sequence = ? WHERE order_id = ? AND status = 'committed'",
    );
    for (const entry of plan.entries) update.run(entry.sequence, entry.orderId);
  })();

  return privateBatch(batchId);
}

/**
 * Settle every revealed order in a batch, in the batch's fixed order.
 *
 * A revealed order has a public commitment but is still only a commitment: the
 * batch is what turns it into trades. Settlement runs through the same
 * `executeSwap` the public path uses, so a private order pays the same fees and
 * moves the same pools as a public one — the private path buys ordering, not a
 * price. Each order settles in its own transaction, so one order that fails
 * (a balance spent elsewhere, a pool paused mid-batch) is recorded as `failed`
 * rather than reverting the orders around it.
 */
export function settleBatch(batchId: string): BatchSettlement {
  assertDexOpen('dex');
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM dex_private_orders WHERE batch_id = ? AND status = 'revealed' ORDER BY sequence ASC")
    .all(batchId) as PrivateOrderRow[];
  if (rows.length === 0) {
    throw new DexError('NOTHING_TO_SETTLE', `batch ${batchId} has no revealed orders`, 409);
  }

  const results: BatchSettlement['results'] = [];
  for (const row of rows) {
    try {
      const swap = executeSwap({
        userId: row.user_id,
        tokenIn: row.token_in,
        tokenOut: row.token_out,
        amountIn: row.amount_in,
      });
      db.prepare("UPDATE dex_private_orders SET status = 'settled' WHERE order_id = ?").run(row.order_id);
      results.push({
        orderId: row.order_id,
        status: 'settled',
        tokenIn: row.token_in,
        tokenOut: row.token_out,
        amountIn: row.amount_in,
        amountOut: swap.amountOut,
      });
    } catch (error) {
      const dexError = error as { code?: string; message?: string };
      db.prepare("UPDATE dex_private_orders SET status = 'failed' WHERE order_id = ?").run(row.order_id);
      results.push({
        orderId: row.order_id,
        status: 'failed',
        tokenIn: row.token_in,
        tokenOut: row.token_out,
        amountIn: row.amount_in,
        reason: dexError.message ?? 'the swap was refused',
      });
    }
  }

  const settled = results.filter((entry) => entry.status === 'settled').length;
  return { batchId, settled, failed: results.length - settled, results };
}

/**
 * Scan the venue's recent settled swaps for a sandwich.
 *
 * The observations come from `dex_swaps`, so the detector runs against what the
 * venue actually executed. Swaps are grouped by the pool they touched, because a
 * sandwich is only meaningful within one pool's price series.
 */
export function scanRecentSandwiches(limit = 200): SandwichDetection & { observations: number } {
  const rows = getDb()
    .prepare(
      `SELECT pool_id, user_id, token_in, token_out, amount_in
         FROM dex_swaps
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(limit) as Array<{ pool_id: string; user_id: string; token_in: string; token_out: string; amount_in: number }>;

  let detected = false;
  const attackers = new Set<string>();
  let victim: string | null = null;

  const byPool = new Map<string, SwapObservation[]>();
  // The query returns newest first; the detector needs the block order, so each
  // pool's series is reversed back to oldest-first before it is examined.
  for (const row of [...rows].reverse()) {
    const list = byPool.get(row.pool_id) ?? [];
    list.push({ trader: row.user_id, tokenIn: row.token_in, tokenOut: row.token_out, amountIn: row.amount_in });
    byPool.set(row.pool_id, list);
  }

  for (const series of byPool.values()) {
    const result = detectSandwich(series);
    if (result.detected) {
      detected = true;
      result.attackers.forEach((attacker) => attackers.add(attacker));
      victim = result.victim ?? victim;
    }
  }

  return { detected, attackers: [...attackers], victim, observations: rows.length };
}
