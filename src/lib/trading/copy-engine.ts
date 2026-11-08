/**
 * Copy-trading engine.
 *
 * A leader is an account that has applied and been approved by an operator; a
 * follower mirrors a leader's fills according to their own copy config. Every
 * figure returned here is derived from rows the exchange wrote itself — the
 * leader's settled spot trades and closed futures positions — so a leader with
 * no history has a genuinely zero ROI rather than a seeded one.
 *
 * The mirroring maths is the pure `copyOrder` planner, so a follower can never
 * be sized past their configured maximum and a fixed-amount follower cannot be
 * asked for an amount they did not set.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { copyOrder, leaderMetrics, profitShare, type CopyConfig } from '@/lib/trading/copy';
import { portfolioSummary } from '@/lib/db/portfolio';

export class CopyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const COPY_MODES = new Set(['fixed', 'ratio']);

export interface CopyTraderView {
  traderId: string;
  userId: string;
  displayName: string;
  markets: string[];
  roi7d: number;
  roi30d: number;
  roi90d: number;
  winRate: number;
  trades: number;
  followers: number;
  maxFollowers: number;
  aum: number;
  profitShare: number;
  status: string;
  createdAt: string;
}

interface TraderRow {
  trader_id: string;
  user_id: string;
  display_name: string;
  markets: string;
  roi_7d: number;
  roi_30d: number;
  roi_90d: number;
  win_rate: number;
  followers: number;
  max_followers: number;
  aum: number;
  profit_share: number;
  status: string;
  created_at: string;
}

function parseMarkets(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** A leader's realized profit over a window, from their own closed positions. */
function realizedProfit(userId: string, sinceModifier: string | null): number {
  const db = getDb();
  const clause = sinceModifier ? " AND updated_at >= datetime('now', ?)" : '';
  const sql = `SELECT COALESCE(SUM(realized_pnl), 0) AS total, COUNT(*) AS trades
                 FROM futures_positions
                WHERE user_id = ? AND status = 'closed'${clause}`;
  const row = (sinceModifier
    ? db.prepare(sql).get(userId, sinceModifier)
    : db.prepare(sql).get(userId)) as { total: number; trades: number } | undefined;
  return Number(row?.total) || 0;
}

/**
 * Recompute a leader's published metrics from their real history.
 *
 * ROI is realized profit over the leader's current portfolio value; win rate is
 * winning closed positions over all closed positions. A leader with no closed
 * positions reports zero for both rather than a placeholder.
 */
function computeMetrics(userId: string): {
  roi7d: number;
  roi30d: number;
  roi90d: number;
  winRate: number;
  trades: number;
} {
  const db = getDb();
  const equity = portfolioSummary(userId).totalBalanceUSDT;

  const rows = db
    .prepare(
      `SELECT realized_pnl FROM futures_positions WHERE user_id = ? AND status = 'closed'`,
    )
    .all(userId) as Array<{ realized_pnl: number }>;
  const trades = rows.length;
  const wins = rows.filter((row) => Number(row.realized_pnl) > 0).length;

  const roi = (profit: number): number => (equity > 0 ? profit / equity : 0);

  return {
    roi7d: roi(realizedProfit(userId, '-7 day')),
    roi30d: roi(realizedProfit(userId, '-30 day')),
    roi90d: roi(realizedProfit(userId, '-90 day')),
    winRate: trades === 0 ? 0 : wins / trades,
    trades,
  };
}

function toView(row: TraderRow, live: boolean): CopyTraderView {
  const metrics = live ? computeMetrics(row.user_id) : null;
  return {
    traderId: row.trader_id,
    userId: row.user_id,
    displayName: row.display_name,
    markets: parseMarkets(row.markets),
    roi7d: metrics ? metrics.roi7d : Number(row.roi_7d) || 0,
    roi30d: metrics ? metrics.roi30d : Number(row.roi_30d) || 0,
    roi90d: metrics ? metrics.roi90d : Number(row.roi_90d) || 0,
    winRate: metrics ? metrics.winRate : Number(row.win_rate) || 0,
    trades: metrics ? metrics.trades : 0,
    followers: Number(row.followers) || 0,
    maxFollowers: Number(row.max_followers) || 0,
    aum: Number(row.aum) || 0,
    profitShare: Number(row.profit_share) || 0,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Approved leaders, ranked by 30-day ROI. Metrics are recomputed live. */
export function listCopyTraders(filter: { limit?: number; sortBy?: string } = {}): CopyTraderView[] {
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50) || 50, 1), 200);
  const rows = getDb()
    .prepare("SELECT * FROM copy_traders WHERE status = 'approved' LIMIT 500")
    .all() as TraderRow[];

  const views = rows.map((row) => toView(row, true));
  const sortBy = String(filter.sortBy ?? 'profit').trim().toLowerCase();
  views.sort((a, b) => {
    if (sortBy === 'roi') return b.roi30d - a.roi30d;
    if (sortBy === 'followers') return b.followers - a.followers;
    if (sortBy === 'winrate') return b.winRate - a.winRate;
    return b.roi30d - a.roi30d;
  });
  return views.slice(0, limit);
}

/** A single leader by id, including one that is not yet approved. */
export function getCopyTrader(traderId: string): CopyTraderView | null {
  const row = getDb().prepare('SELECT * FROM copy_traders WHERE trader_id = ?').get(traderId) as
    | TraderRow
    | undefined;
  return row ? toView(row, row.status === 'approved') : null;
}

/** The leader profile belonging to an account, if it has one. */
export function leaderProfile(userId: string): CopyTraderView | null {
  const row = getDb().prepare('SELECT * FROM copy_traders WHERE user_id = ?').get(userId) as
    | TraderRow
    | undefined;
  return row ? toView(row, row.status === 'approved') : null;
}

/**
 * Apply to become a copy-trading leader.
 *
 * The application is created in `pending` state: an operator must approve it
 * before followers can copy it, so an account cannot publish itself as a leader.
 */
export function applyAsLeader(userId: string, input: { displayName: string; markets?: string[] }): CopyTraderView {
  const displayName = String(input.displayName ?? '').trim();
  if (displayName.length < 1 || displayName.length > 40) {
    throw new CopyError('VALIDATION_FAILED', 'A display name of 1 to 40 characters is required');
  }
  const markets = Array.isArray(input.markets) ? input.markets.map((m) => String(m).toUpperCase()).slice(0, 20) : [];

  const db = getDb();
  const existing = db.prepare('SELECT trader_id FROM copy_traders WHERE user_id = ?').get(userId) as
    | { trader_id: string }
    | undefined;
  if (existing) {
    throw new CopyError('ALREADY_APPLIED', 'This account already has a leader profile', 409);
  }

  const traderId = generateId();
  db.prepare(
    `INSERT INTO copy_traders (trader_id, user_id, display_name, markets, status)
     VALUES (?, ?, ?, ?, 'pending')`,
  ).run(traderId, userId, displayName, JSON.stringify(markets));

  const created = getCopyTrader(traderId);
  if (!created) throw new CopyError('INTERNAL_ERROR', 'The leader profile could not be created', 500);
  return created;
}

export interface FollowView {
  followId: string;
  traderId: string;
  leaderName: string;
  mode: string;
  fixedAmount: number | null;
  ratio: number | null;
  maxPosition: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  status: string;
  createdAt: string;
}

function followView(row: Record<string, unknown>): FollowView {
  return {
    followId: String(row.follow_id),
    traderId: String(row.trader_id),
    leaderName: String(row.display_name ?? ''),
    mode: String(row.copy_mode),
    fixedAmount: row.fixed_amount === null || row.fixed_amount === undefined ? null : Number(row.fixed_amount),
    ratio: row.ratio === null || row.ratio === undefined ? null : Number(row.ratio),
    maxPosition: row.max_position === null || row.max_position === undefined ? null : Number(row.max_position),
    takeProfit: row.take_profit === null || row.take_profit === undefined ? null : Number(row.take_profit),
    stopLoss: row.stop_loss === null || row.stop_loss === undefined ? null : Number(row.stop_loss),
    status: String(row.status),
    createdAt: String(row.created_at),
  };
}

function validateFollowConfig(input: {
  mode: string;
  fixedAmount?: unknown;
  ratio?: unknown;
  maxPosition?: unknown;
}): void {
  if (!COPY_MODES.has(input.mode)) {
    throw new CopyError('VALIDATION_FAILED', 'mode must be fixed or ratio');
  }
  const amount = Number(input.fixedAmount);
  const ratio = Number(input.ratio);
  if (input.mode === 'fixed') {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new CopyError('VALIDATION_FAILED', 'fixedAmount must be positive in fixed mode');
    }
  } else if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new CopyError('VALIDATION_FAILED', 'ratio must be positive in ratio mode');
  }
  if (input.maxPosition !== undefined && input.maxPosition !== null) {
    const cap = Number(input.maxPosition);
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new CopyError('VALIDATION_FAILED', 'maxPosition must be positive when set');
    }
  }
}

/** Start following a leader. The leader must be approved and not full. */
export function followLeader(
  followerId: string,
  input: {
    traderId: string;
    mode?: string;
    fixedAmount?: unknown;
    ratio?: unknown;
    maxPosition?: unknown;
    takeProfit?: unknown;
    stopLoss?: unknown;
  },
): FollowView {
  const traderId = String(input.traderId ?? '').trim();
  if (!traderId) throw new CopyError('VALIDATION_FAILED', 'A traderId is required');

  const db = getDb();
  const trader = db
    .prepare('SELECT trader_id, user_id, status, followers, max_followers FROM copy_traders WHERE trader_id = ?')
    .get(traderId) as
    | { trader_id: string; user_id: string; status: string; followers: number; max_followers: number }
    | undefined;
  if (!trader) throw new CopyError('UNKNOWN_TRADER', 'No such copy trader', 404);
  if (trader.status !== 'approved') {
    throw new CopyError('TRADER_NOT_APPROVED', 'This trader is not open for copying', 409);
  }
  if (trader.user_id === followerId) {
    throw new CopyError('CANNOT_COPY_SELF', 'You cannot copy your own account', 409);
  }
  if (Number(trader.followers) >= Number(trader.max_followers)) {
    throw new CopyError('FOLLOWERS_FULL', 'This trader has reached their follower limit', 409);
  }

  const mode = String(input.mode ?? 'ratio').trim().toLowerCase();
  validateFollowConfig({ mode, fixedAmount: input.fixedAmount, ratio: input.ratio, maxPosition: input.maxPosition });

  const existing = db
    .prepare('SELECT follow_id FROM copy_follows WHERE follower_id = ? AND trader_id = ?')
    .get(followerId, traderId) as { follow_id: string } | undefined;
  if (existing) throw new CopyError('ALREADY_FOLLOWING', 'You already follow this trader', 409);

  const followId = generateId();
  const numeric = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  db.transaction(() => {
    db.prepare(
      `INSERT INTO copy_follows
         (follow_id, follower_id, trader_id, copy_mode, fixed_amount, ratio, max_position, take_profit, stop_loss, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    ).run(
      followId,
      followerId,
      traderId,
      mode,
      numeric(input.fixedAmount),
      numeric(input.ratio),
      numeric(input.maxPosition),
      numeric(input.takeProfit),
      numeric(input.stopLoss),
    );
    db.prepare('UPDATE copy_traders SET followers = followers + 1 WHERE trader_id = ?').run(traderId);
  })();

  const row = db
    .prepare(
      `SELECT f.*, t.display_name FROM copy_follows f JOIN copy_traders t ON t.trader_id = f.trader_id
        WHERE f.follow_id = ?`,
    )
    .get(followId) as Record<string, unknown>;
  return followView(row);
}

/** Update a follow's configuration. */
export function updateFollow(
  followerId: string,
  followId: string,
  changes: { mode?: string; fixedAmount?: unknown; ratio?: unknown; maxPosition?: unknown; status?: string },
): FollowView {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM copy_follows WHERE follow_id = ? AND follower_id = ?')
    .get(followId, followerId) as Record<string, unknown> | undefined;
  if (!row) throw new CopyError('NOT_FOUND', 'No such follow for this account', 404);

  const mode = changes.mode === undefined ? String(row.copy_mode) : String(changes.mode).toLowerCase();
  validateFollowConfig({
    mode,
    fixedAmount: changes.fixedAmount ?? row.fixed_amount,
    ratio: changes.ratio ?? row.ratio,
    maxPosition: changes.maxPosition ?? row.max_position,
  });

  const assignments: string[] = ['copy_mode = ?'];
  const params: Array<string | number | null> = [mode];
  const numeric = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  for (const [key, column] of [
    ['fixedAmount', 'fixed_amount'],
    ['ratio', 'ratio'],
    ['maxPosition', 'max_position'],
  ] as const) {
    if (changes[key] !== undefined) {
      assignments.push(`${column} = ?`);
      params.push(numeric(changes[key]));
    }
  }
  if (changes.status !== undefined) {
    const status = String(changes.status).toLowerCase();
    if (!['active', 'paused'].includes(status)) {
      throw new CopyError('VALIDATION_FAILED', 'status must be active or paused');
    }
    assignments.push('status = ?');
    params.push(status);
  }

  db.prepare(`UPDATE copy_follows SET ${assignments.join(', ')} WHERE follow_id = ?`).run(...params, followId);

  const updated = db
    .prepare(
      `SELECT f.*, t.display_name FROM copy_follows f JOIN copy_traders t ON t.trader_id = f.trader_id
        WHERE f.follow_id = ?`,
    )
    .get(followId) as Record<string, unknown>;
  return followView(updated);
}

/** Stop following a leader and release the follower slot. */
export function unfollow(followerId: string, followId: string): void {
  const db = getDb();
  const row = db
    .prepare('SELECT trader_id FROM copy_follows WHERE follow_id = ? AND follower_id = ?')
    .get(followId, followerId) as { trader_id: string } | undefined;
  if (!row) throw new CopyError('NOT_FOUND', 'No such follow for this account', 404);

  db.transaction(() => {
    db.prepare('DELETE FROM copy_follows WHERE follow_id = ?').run(followId);
    db.prepare(
      "UPDATE copy_traders SET followers = MAX(followers - 1, 0) WHERE trader_id = ?",
    ).run(row.trader_id);
  })();
}

/** The leaders an account follows. */
export function listFollowing(followerId: string): FollowView[] {
  const rows = getDb()
    .prepare(
      `SELECT f.*, t.display_name FROM copy_follows f JOIN copy_traders t ON t.trader_id = f.trader_id
        WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 200`,
    )
    .all(followerId) as Array<Record<string, unknown>>;
  return rows.map(followView);
}

export interface MirroredOrder {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  notional: number;
  leaderPrice: number;
  leaderTradeAt: string;
  traderId: string;
}

/**
 * The orders a follower's config would mirror from a leader's recent fills.
 *
 * Each entry is computed by the pure `copyOrder` planner from a real settled
 * fill and the follower's own config, so the quantity is exactly what the copy
 * path would submit. A fill whose notional rounds to nothing is omitted rather
 * than emitted as a zero-size order.
 */
export function mirroredOrders(followerId: string, limit = 100): MirroredOrder[] {
  const db = getDb();
  const follows = db
    .prepare(
      `SELECT f.*, t.user_id AS leader_user_id
         FROM copy_follows f JOIN copy_traders t ON t.trader_id = f.trader_id
        WHERE f.follower_id = ? AND f.status = 'active'`,
    )
    .all(followerId) as Array<Record<string, unknown>>;
  if (follows.length === 0) return [];

  const followerEquity = portfolioSummary(followerId).totalBalanceUSDT;
  const out: MirroredOrder[] = [];

  for (const follow of follows) {
    const leaderUserId = String(follow.leader_user_id);
    const leaderEquity = portfolioSummary(leaderUserId).totalBalanceUSDT;
    const fills = db
      .prepare(
        `SELECT h.side, h.filled_quantity AS quantity, h.average_price AS price, h.created_at,
                p.symbol
           FROM order_history h JOIN trading_pairs p ON p.pair_id = h.pair_id
          WHERE h.user_id = ? AND h.status = 'filled'
                AND h.filled_quantity > 0 AND h.average_price > 0
                AND h.created_at >= ?
          ORDER BY h.created_at DESC
          LIMIT ?`,
      )
      .all(leaderUserId, String(follow.created_at), Math.min(Math.max(limit, 1), 500)) as Array<{
      side: string;
      quantity: number;
      price: number;
      created_at: string;
      symbol: string;
    }>;

    const config: CopyConfig = {
      mode: follow.copy_mode === 'fixed' ? 'fixed' : 'ratio',
      fixedAmount: follow.fixed_amount === null ? undefined : Number(follow.fixed_amount),
      ratio: follow.ratio === null ? undefined : Number(follow.ratio),
      maxPosition: follow.max_position === null ? undefined : Number(follow.max_position),
    };

    for (const fill of fills) {
      const order = copyOrder(
        {
          symbol: fill.symbol,
          side: fill.side === 'sell' ? 'sell' : 'buy',
          price: Number(fill.price),
          quantity: Number(fill.quantity),
          leaderEquity,
        },
        config,
        followerEquity,
      );
      if (!order || 'error' in order) continue;
      out.push({
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        notional: order.notional,
        leaderPrice: Number(fill.price),
        leaderTradeAt: fill.created_at,
        traderId: String(follow.trader_id),
      });
    }
  }

  return out.slice(0, Math.min(Math.max(limit, 1), 500));
}

export interface ProfitEvent {
  followId: string;
  traderId: string;
  leaderName: string;
  realizedProfit: number;
  profitShare: number;
  profitShareRate: number;
  settledAt: string;
}

/**
 * A follower's profit history with each leader they follow.
 *
 * The follower's share of a leader's realized profit over the window is the
 * leader's profit weighted by the follower's copy ratio (or capped by their
 * maximum), then split at the leader's profit-share rate. A loss pays nothing.
 */
export function profitHistory(followerId: string, limit = 50): ProfitEvent[] {
  const db = getDb();
  const follows = db
    .prepare(
      `SELECT f.follow_id, f.trader_id, f.copy_mode, f.fixed_amount, f.ratio, f.max_position,
              t.display_name, t.user_id AS leader_user_id, t.profit_share
         FROM copy_follows f JOIN copy_traders t ON t.trader_id = f.trader_id
        WHERE f.follower_id = ?`,
    )
    .all(followerId) as Array<Record<string, unknown>>;

  const followerEquity = portfolioSummary(followerId).totalBalanceUSDT;
  const events: ProfitEvent[] = [];

  for (const follow of follows) {
    const leaderUserId = String(follow.leader_user_id);
    const leaderEquity = portfolioSummary(leaderUserId).totalBalanceUSDT;
    const positions = db
      .prepare(
        `SELECT realized_pnl, updated_at FROM futures_positions
          WHERE user_id = ? AND status = 'closed' AND updated_at IS NOT NULL
          ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(leaderUserId, Math.min(Math.max(limit, 1), 200)) as Array<{
      realized_pnl: number;
      updated_at: string;
    }>;

    const rate = Number(follow.profit_share) || 0;
    const scale = copyScale(follow, leaderEquity, followerEquity);

    for (const position of positions) {
      const followerProfit = Number(position.realized_pnl) * scale;
      events.push({
        followId: String(follow.follow_id),
        traderId: String(follow.trader_id),
        leaderName: String(follow.display_name),
        realizedProfit: followerProfit,
        profitShare: profitShare(followerProfit, rate),
        profitShareRate: rate,
        settledAt: position.updated_at,
      });
    }
  }

  events.sort((a, b) => Date.parse(b.settledAt) - Date.parse(a.settledAt));
  return events.slice(0, Math.min(Math.max(limit, 1), 200));
}

/**
 * The fraction of a leader's position the follower mirrors.
 *
 * Ratio mode scales the leader's equity fraction to the follower's equity,
 * bounded by the follower's maximum notional. Fixed mode returns zero scale
 * because a fixed follower is sized per trade, not proportionally.
 */
function copyScale(follow: Record<string, unknown>, leaderEquity: number, followerEquity: number): number {
  if (follow.copy_mode === 'fixed') return 0;
  const ratio = Number(follow.ratio) || 0;
  if (leaderEquity <= 0 || followerEquity <= 0) return 0;
  const scale = (followerEquity / leaderEquity) * ratio;
  const cap = follow.max_position === null || follow.max_position === undefined ? null : Number(follow.max_position);
  if (cap === null || cap <= 0) return scale;
  const cappedScale = cap / leaderEquity;
  return Math.min(scale, cappedScale);
}

export { leaderMetrics };
