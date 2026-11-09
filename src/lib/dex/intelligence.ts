/**
 * Venue-wide trading intelligence, computed from TigerSwap's own settled rows.
 *
 * The ranking, the whale detection and the smart-money signal all read the
 * same `dex_swaps` and `dex_perp_positions` tables the settlement paths write,
 * so a figure here is never an estimate or a mirrored feed. Value is only
 * assigned where the venue can price an asset itself; a holding the venue
 * cannot price is left out of a ranking rather than valued at zero.
 *
 * Framework-free: it touches the database and the price table, never a
 * request, so it is unit-testable and can back both an API route and a view.
 */

import { getDb } from '@/lib/db';
import { priceInQuote } from '@/lib/trading/valuation';

export interface TopTrader {
  userId: string;
  swaps: number;
  volumeUsd: number;
  feesUsd: number;
  realizedPnlUsd: number;
  lastTradeAt: string | null;
}

export interface WhaleAlert {
  userId: string;
  asset: string;
  side: 'buy' | 'sell';
  amount: number;
  valueUsd: number;
  poolId: string;
  at: string | null;
}

export interface SmartMoneySignal {
  asset: string;
  direction: 'accumulation' | 'distribution';
  netUsd: number;
  buyers: number;
  sellers: number;
  strength: number;
}

export interface TraderLeaderboard {
  traders: TopTrader[];
  totalVolumeUsd: number;
  fullyPriced: boolean;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Value an asset amount in the venue's own quote unit, or null when unpriceable. */
function valueOf(asset: string, amount: number): number | null {
  const price = priceInQuote(asset, 'RUSD');
  if (price === null || !Number.isFinite(price)) return null;
  return price * amount;
}

/**
 * Rank the venue's traders by realised profit, then by volume.
 *
 * Volume is counted in the quote unit each swap settled in; a swap whose input
 * the venue cannot price contributes nothing to volume rather than a guessed
 * figure. Realised profit is the sum the venue booked against the trader's
 * closed perpetual positions, so it is a settled number, not a mark.
 */
export function traderLeaderboard(limit = 25): TraderLeaderboard {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('limit must be an integer between 1 and 500');
  }
  const db = getDb();
  const swaps = db
    .prepare(
      `SELECT user_id, token_in, amount_in, fee, created_at
         FROM dex_swaps ORDER BY created_at DESC LIMIT 20000`,
    )
    .all() as Array<{ user_id: string; token_in: string; amount_in: number; fee: number; created_at: string | null }>;

  const byUser = new Map<string, TopTrader>();
  let totalVolumeUsd = 0;
  let fullyPriced = true;
  for (const swap of swaps) {
    const entry = byUser.get(swap.user_id) ?? {
      userId: swap.user_id,
      swaps: 0,
      volumeUsd: 0,
      feesUsd: 0,
      realizedPnlUsd: 0,
      lastTradeAt: null,
    };
    const value = valueOf(swap.token_in, num(swap.amount_in));
    if (value === null) fullyPriced = false;
    else {
      entry.volumeUsd += value;
      totalVolumeUsd += value;
    }
    entry.swaps += 1;
    entry.feesUsd += num(swap.fee);
    if (!entry.lastTradeAt || (swap.created_at && swap.created_at > entry.lastTradeAt)) entry.lastTradeAt = swap.created_at;
    byUser.set(swap.user_id, entry);
  }

  const pnl = db
    .prepare(
      `SELECT user_id, COALESCE(SUM(realized_pnl), 0) AS pnl
         FROM dex_perp_positions WHERE status = 'closed' GROUP BY user_id`,
    )
    .all() as Array<{ user_id: string; pnl: number }>;
  for (const row of pnl) {
    const entry = byUser.get(row.user_id);
    if (entry) entry.realizedPnlUsd = num(row.pnl);
    else byUser.set(row.user_id, { userId: row.user_id, swaps: 0, volumeUsd: 0, feesUsd: 0, realizedPnlUsd: num(row.pnl), lastTradeAt: null });
  }

  const traders = [...byUser.values()]
    .sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd || b.volumeUsd - a.volumeUsd)
    .slice(0, limit);
  return { traders, totalVolumeUsd, fullyPriced };
}

/**
 * Find swaps large enough to be worth surfacing as whale activity.
 *
 * A swap is a whale alert when its quote value is at or above `thresholdUsd`.
 * Swaps whose input the venue cannot price are skipped, because a threshold
 * cannot be applied to an unknown value.
 */
export function whaleAlerts(thresholdUsd = 10_000, limit = 50): WhaleAlert[] {
  if (!Number.isFinite(thresholdUsd) || thresholdUsd <= 0) throw new Error('threshold must be positive');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be an integer between 1 and 1000');
  const db = getDb();
  const swaps = db
    .prepare(
      `SELECT swap_id, pool_id, user_id, token_in, token_out, amount_in, amount_out, created_at
         FROM dex_swaps ORDER BY created_at DESC LIMIT 20000`,
    )
    .all() as Array<{
    swap_id: string;
    pool_id: string;
    user_id: string;
    token_in: string;
    token_out: string;
    amount_in: number;
    amount_out: number;
    created_at: string | null;
  }>;

  const alerts: WhaleAlert[] = [];
  for (const swap of swaps) {
    // Report the leg that carried the value: the larger of what came out and
    // what went in. A whale selling into the pool is surfaced as a sale of the
    // input rather than an uninformative small buy of the output.
    const outValue = valueOf(swap.token_out, num(swap.amount_out));
    const inValue = valueOf(swap.token_in, num(swap.amount_in));
    const bought = outValue !== null && (inValue === null || outValue >= inValue);
    const valueUsd = bought ? outValue : inValue;
    if (valueUsd === null || valueUsd < thresholdUsd) continue;
    alerts.push({
      userId: swap.user_id,
      asset: bought ? swap.token_out : swap.token_in,
      side: bought ? 'buy' : 'sell',
      amount: bought ? num(swap.amount_out) : num(swap.amount_in),
      valueUsd,
      poolId: swap.pool_id,
      at: swap.created_at,
    });
    if (alerts.length >= limit) break;
  }
  return alerts;
}

/**
 * Aggregate recent flow per asset into an accumulation or distribution signal.
 *
 * Net flow is the quote value bought minus the quote value sold across the
 * window. `strength` is the net flow over gross flow, so it is bounded to
 * [-1, 1] and comparable between assets of different sizes: +1 means every
 * priced trade bought the asset and -1 means every priced trade sold it. Assets
 * with too few priced trades to be meaningful are omitted.
 */
export function smartMoneySignals(windowDays = 1, minTrades = 3): SmartMoneySignal[] {
  if (!Number.isFinite(windowDays) || windowDays <= 0) throw new Error('windowDays must be positive');
  if (!Number.isInteger(minTrades) || minTrades < 1) throw new Error('minTrades must be a positive integer');
  const db = getDb();
  const swaps = db
    .prepare(
      `SELECT user_id, token_in, token_out, amount_in, amount_out
         FROM dex_swaps WHERE created_at >= datetime('now', ?)`,
    )
    .all(`-${Math.floor(windowDays)} day`) as Array<{
    user_id: string;
    token_in: string;
    token_out: string;
    amount_in: number;
    amount_out: number;
  }>;

  interface Accum {
    boughtUsd: number;
    soldUsd: number;
    buyers: Set<string>;
    sellers: Set<string>;
  }
  const perAsset = new Map<string, Accum>();
  const bucket = (asset: string): Accum => {
    const existing = perAsset.get(asset) ?? { boughtUsd: 0, soldUsd: 0, buyers: new Set<string>(), sellers: new Set<string>() };
    perAsset.set(asset, existing);
    return existing;
  };

  for (const swap of swaps) {
    const bought = valueOf(swap.token_out, num(swap.amount_out));
    if (bought !== null) {
      const entry = bucket(swap.token_out);
      entry.boughtUsd += bought;
      entry.buyers.add(swap.user_id);
    }
    const sold = valueOf(swap.token_in, num(swap.amount_in));
    if (sold !== null) {
      const entry = bucket(swap.token_in);
      entry.soldUsd += sold;
      entry.sellers.add(swap.user_id);
    }
  }

  const signals: SmartMoneySignal[] = [];
  for (const [asset, entry] of perAsset) {
    const gross = entry.boughtUsd + entry.soldUsd;
    const trades = entry.buyers.size + entry.sellers.size;
    if (gross <= 0 || trades < minTrades) continue;
    const netUsd = entry.boughtUsd - entry.soldUsd;
    signals.push({
      asset,
      direction: netUsd >= 0 ? 'accumulation' : 'distribution',
      netUsd,
      buyers: entry.buyers.size,
      sellers: entry.sellers.size,
      strength: netUsd / gross,
    });
  }
  return signals.sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd));
}
