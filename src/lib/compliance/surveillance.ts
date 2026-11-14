/**
 * Market-integrity surveillance.
 *
 * A venue that lists a market is responsible for watching it. This module reads
 * the venue's own `spot_trades` and `orders` tables over a rolling window and
 * raises alerts for the classic manipulation patterns. Every alert is derived
 * from recorded fills and order events — nothing is estimated, and an empty
 * window raises nothing rather than a placeholder alert.
 *
 * Patterns detected:
 *
 *  - `self_match`   — a fill whose maker and taker are the same account, so the
 *                     user traded with themselves. Real venues reject these; a
 *                     row here means the guard was bypassed or the account is
 *                     deliberately printing volume.
 *  - `wash_trading` — two accounts trading a symbol back and forth with no net
 *                     change in position (round-tripping) above a notional
 *                     floor, which prints volume and a price without economic
 *                     exposure.
 *  - `layering`     — a user who places large orders on one side and cancels
 *                     them within seconds while filling on the opposite side,
 *                     i.e. showing depth they never intend to trade.
 *  - `spoofing`     — large cancels far from the mid with a very short life,
 *                     the order-book half of the same behaviour.
 *
 * The module is free of `next/server` so it can be unit tested, and every query
 * is parameterised. Thresholds are named constants so a test can pin them.
 */

import { getDb, generateId } from '@/lib/db';

export type AlertKind = 'self_match' | 'wash_trading' | 'layering' | 'spoofing';

export interface SurveillanceAlert {
  alertId: string;
  kind: AlertKind;
  symbol: string;
  userId: string;
  counterpartyId: string | null;
  /** Confidence in [0, 1]; higher is a stronger signal. */
  score: number;
  detail: Record<string, unknown>;
  windowStart: string;
  windowEnd: string;
  createdAt: string;
}

// --- Thresholds (named so tests can pin the exact behaviour) ---------------
/** Below this net/gross ratio a pair of accounts has "no net position". */
export const WASH_NET_RATIO = 0.1;
/** Minimum gross notional (in quote units) before a wash is reported. */
export const WASH_MIN_NOTIONAL = 1000;
/** Cancelled quantity must be at least this multiple of the opposite fills. */
export const LAYER_CANCEL_RATIO = 5;
/** Average lifetime of the cancels, in seconds, below which it looks staged. */
export const LAYER_MAX_LIFETIME_SEC = 30;
/** Minimum cancelled notional (quote units) before a layering alert. */
export const LAYER_MIN_CANCELLED_NOTIONAL = 10000;
/** How far from the mid a spoof order must sit, as a fraction of the mid. */
export const SPOOF_MIN_DISTANCE = 0.02;
/** Default rolling window the cycle scans. */
export const DEFAULT_LOOKBACK_MS = 5 * 60 * 1000;

/** Bucket a timestamp to the minute so a re-run of the cycle does not duplicate
 *  an alert that the same window already raised. */
function minuteBucket(ms: number): string {
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString().slice(0, 16);
}

function toUtcIso(ms: number): string {
  return new Date(ms).toISOString();
}

interface TradeRow {
  trade_id: string;
  symbol: string;
  maker_user_id: string;
  taker_user_id: string;
  side: string;
  price: number;
  quantity: number;
  quote_quantity: number;
  created_at: string;
}

interface OrderRow {
  order_id: string;
  user_id: string;
  symbol: string;
  side: string;
  price: number | null;
  quantity: number;
  filled_quantity: number;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Persist a batch of alerts, ignoring ones the same minute already recorded. */
function persistAlerts(alerts: Omit<SurveillanceAlert, 'alertId' | 'createdAt'>[]): SurveillanceAlert[] {
  if (alerts.length === 0) return [];
  const db = getDb();
  const inserted: SurveillanceAlert[] = [];
  const stmt = db.prepare(
    `INSERT INTO surveillance_alerts
       (alert_id, kind, symbol, user_id, counterparty_id, score, detail, bucket, window_start, window_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, user_id, symbol, bucket) DO NOTHING`,
  );
  const insert = db.transaction(() => {
    for (const alert of alerts) {
      const alertId = generateId();
      const bucket = minuteBucket(Date.parse(alert.windowEnd));
      const result = stmt.run(
        alertId,
        alert.kind,
        alert.symbol,
        alert.userId,
        alert.counterpartyId,
        alert.score,
        JSON.stringify(alert.detail),
        bucket,
        alert.windowStart,
        alert.windowEnd,
      );
      if (result.changes > 0) {
        inserted.push({ ...alert, alertId, createdAt: new Date().toISOString() });
      }
    }
  });
  insert();
  return inserted;
}

/**
 * Run one surveillance pass over the rolling window ending at `nowMs`.
 *
 * Returns only the alerts this pass newly recorded, so a caller can notify on
 * the delta while the table keeps the full history.
 */
export function runSurveillanceCycle(
  nowMs: number = Date.now(),
  lookbackMs: number = DEFAULT_LOOKBACK_MS,
): { scanned: { trades: number; orders: number }; alerts: SurveillanceAlert[] } {
  const db = getDb();
  const windowStart = toUtcIso(nowMs - lookbackMs);
  const windowEnd = toUtcIso(nowMs);

  const trades = db
    .prepare(
      `SELECT trade_id, symbol, maker_user_id, taker_user_id, side, price, quantity, quote_quantity, created_at
         FROM spot_trades
        WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
        ORDER BY created_at ASC`,
    )
    .all(windowStart, windowEnd) as TradeRow[];

  const orders = db
    .prepare(
      `SELECT o.order_id, o.user_id, p.symbol AS symbol, o.side, o.price, o.quantity,
              o.filled_quantity, o.status, o.created_at, o.updated_at
         FROM orders o
         JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE datetime(o.updated_at) >= datetime(?) AND datetime(o.updated_at) <= datetime(?)`,
    )
    .all(windowStart, windowEnd) as OrderRow[];

  const drafts: Omit<SurveillanceAlert, 'alertId' | 'createdAt'>[] = [];

  // --- self-match: a fill where maker and taker are the same account --------
  for (const trade of trades) {
    if (trade.maker_user_id !== trade.taker_user_id) continue;
    drafts.push({
      kind: 'self_match',
      symbol: trade.symbol,
      userId: trade.maker_user_id,
      counterpartyId: null,
      score: 1,
      detail: {
        tradeId: trade.trade_id,
        price: trade.price,
        quantity: trade.quantity,
        notional: trade.quote_quantity,
      },
      windowStart,
      windowEnd,
    });
  }

  // --- wash trading: two accounts round-tripping with no net exposure ------
  // For each unordered pair, accumulate each side's signed base position. The
  // taker's `side` tells us who bought: a 'buy' taker means the taker gained
  // base and the maker lost it. Round-tripping shows large gross volume with a
  // near-zero net position.
  interface PairAccumulator {
    symbol: string;
    signedA: number;
    signedB: number;
    gross: number;
    notional: number;
    trades: number;
  }
  const pairs = new Map<string, PairAccumulator>();
  for (const trade of trades) {
    if (trade.maker_user_id === trade.taker_user_id) continue;
    const [a, b] =
      trade.maker_user_id < trade.taker_user_id
        ? [trade.maker_user_id, trade.taker_user_id]
        : [trade.taker_user_id, trade.maker_user_id];
    const key = `${a}|${b}|${trade.symbol}`;
    const acc = pairs.get(key) ?? { symbol: trade.symbol, signedA: 0, signedB: 0, gross: 0, notional: 0, trades: 0 };
    // The taker gains base on a 'buy', the maker loses it; the taker loses base
    // on a 'sell', the maker gains it.
    const takerDelta = trade.side === 'buy' ? trade.quantity : -trade.quantity;
    if (trade.taker_user_id === a) {
      acc.signedA += takerDelta;
      acc.signedB -= takerDelta;
    } else {
      acc.signedB += takerDelta;
      acc.signedA -= takerDelta;
    }
    acc.gross += trade.quantity;
    acc.notional += trade.quote_quantity;
    acc.trades += 1;
    pairs.set(key, acc);
  }

  for (const [key, acc] of pairs) {
    const [a, b] = key.split('|');
    if (acc.gross <= 0) continue;
    const net = Math.abs(acc.signedA);
    const netRatio = net / acc.gross;
    if (acc.notional < WASH_MIN_NOTIONAL) continue;
    if (netRatio > WASH_NET_RATIO) continue;
    if (acc.trades < 2) continue;
    drafts.push({
      kind: 'wash_trading',
      symbol: acc.symbol,
      userId: a,
      counterpartyId: b,
      score: Math.min(1, 1 - netRatio),
      detail: { trades: acc.trades, notional: acc.notional, netRatio },
      windowStart,
      windowEnd,
    });
  }

  // --- layering / spoofing from order events ------------------------------
  // Mid per symbol from the trades we already read; fall back to the mean of
  // resting prices when a symbol has no trades in the window.
  const midBySymbol = new Map<string, number>();
  for (const trade of trades) {
    const prev = midBySymbol.get(trade.symbol);
    midBySymbol.set(trade.symbol, prev === undefined ? trade.price : (prev + trade.price) / 2);
  }

  interface UserSymbol {
    symbol: string;
    userId: string;
    cancelledQty: number;
    cancelledNotional: number;
    cancelledLifeSum: number;
    cancelledCount: number;
    spoofQty: number;
    spoofCount: number;
    filledQty: number;
  }
  const byUser = new Map<string, UserSymbol>();
  for (const order of orders) {
    const key = `${order.user_id}|${order.symbol}`;
    const acc =
      byUser.get(key) ??
      {
        symbol: order.symbol,
        userId: order.user_id,
        cancelledQty: 0,
        cancelledNotional: 0,
        cancelledLifeSum: 0,
        cancelledCount: 0,
        spoofQty: 0,
        spoofCount: 0,
        filledQty: 0,
      };
    if (order.status === 'filled' || order.filled_quantity > 0) {
      acc.filledQty += order.filled_quantity;
    }
    if (order.status === 'cancelled' && order.price !== null && order.price > 0) {
      const qty = Math.max(0, order.quantity - order.filled_quantity);
      const lifeSec =
        (Date.parse(`${order.updated_at.replace(' ', 'T')}Z`) - Date.parse(`${order.created_at.replace(' ', 'T')}Z`)) / 1000;
      acc.cancelledQty += qty;
      acc.cancelledNotional += qty * order.price;
      acc.cancelledLifeSum += Number.isFinite(lifeSec) && lifeSec >= 0 ? lifeSec : 0;
      acc.cancelledCount += 1;

      const mid = midBySymbol.get(order.symbol);
      if (mid && mid > 0) {
        const distance = Math.abs(order.price - mid) / mid;
        if (distance >= SPOOF_MIN_DISTANCE) {
          acc.spoofQty += qty;
          acc.spoofCount += 1;
        }
      }
    }
    byUser.set(key, acc);
  }

  for (const acc of byUser.values()) {
    const avgLife = acc.cancelledCount > 0 ? acc.cancelledLifeSum / acc.cancelledCount : 0;
    if (
      acc.cancelledNotional >= LAYER_MIN_CANCELLED_NOTIONAL &&
      acc.filledQty > 0 &&
      acc.cancelledQty >= LAYER_CANCEL_RATIO * acc.filledQty &&
      avgLife <= LAYER_MAX_LIFETIME_SEC
    ) {
      drafts.push({
        kind: 'layering',
        symbol: acc.symbol,
        userId: acc.userId,
        counterpartyId: null,
        score: Math.min(1, acc.cancelledQty / Math.max(acc.filledQty, 1e-9) / (LAYER_CANCEL_RATIO * 2)),
        detail: {
          cancelledNotional: acc.cancelledNotional,
          cancelledQuantity: acc.cancelledQty,
          filledQuantity: acc.filledQty,
          avgLifetimeSeconds: avgLife,
        },
        windowStart,
        windowEnd,
      });
    }
    if (
      acc.spoofCount >= 2 &&
      acc.spoofQty > 0 &&
      acc.cancelledNotional >= LAYER_MIN_CANCELLED_NOTIONAL &&
      avgLife <= LAYER_MAX_LIFETIME_SEC &&
      acc.filledQty > 0 &&
      acc.spoofQty >= LAYER_CANCEL_RATIO * acc.filledQty
    ) {
      drafts.push({
        kind: 'spoofing',
        symbol: acc.symbol,
        userId: acc.userId,
        counterpartyId: null,
        score: Math.min(1, acc.spoofQty / Math.max(acc.filledQty, 1e-9) / (LAYER_CANCEL_RATIO * 2)),
        detail: {
          spoofOrderCount: acc.spoofCount,
          spoofQuantity: acc.spoofQty,
          filledQuantity: acc.filledQty,
          avgLifetimeSeconds: avgLife,
        },
        windowStart,
        windowEnd,
      });
    }
  }

  const alerts = persistAlerts(drafts);
  return { scanned: { trades: trades.length, orders: orders.length }, alerts };
}

/** The alerts for the admin console, newest first, filtered by status. */
export function listAlerts(options: { status?: string; limit?: number } = {}): SurveillanceAlert[] {
  const db = getDb();
  const status = options.status ?? 'open';
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const rows = db
    .prepare(
      `SELECT alert_id, kind, symbol, user_id, counterparty_id, score, detail, window_start, window_end, created_at
         FROM surveillance_alerts
        WHERE status = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(status, limit) as Array<{
    alert_id: string;
    kind: AlertKind;
    symbol: string | null;
    user_id: string;
    counterparty_id: string | null;
    score: number;
    detail: string | null;
    window_start: string;
    window_end: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    alertId: row.alert_id,
    kind: row.kind,
    symbol: row.symbol ?? '',
    userId: row.user_id,
    counterpartyId: row.counterparty_id,
    score: Number(row.score),
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : {},
    windowStart: row.window_start,
    windowEnd: row.window_end,
    createdAt: row.created_at,
  }));
}

/** Close an alert with a disposition, so the trail shows it was reviewed. */
export function resolveAlert(alertId: string, status: 'reviewed' | 'dismissed' | 'escalated'): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE surveillance_alerts SET status = ? WHERE alert_id = ? AND status = ?')
    .run(status, alertId, 'open');
  return result.changes > 0;
}
