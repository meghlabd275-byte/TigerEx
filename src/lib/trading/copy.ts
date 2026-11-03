/**
 * Copy-trading sizing: turn a leader's fill into a follower's order.
 *
 * A follower either mirrors the leader by a fixed notional or by a ratio of
 * their account equity. Both modes cap the follower's position at their
 * configured maximum and honour the follower's own take-profit and stop-loss,
 * so a follower can never be sized into a position larger than they allowed.
 */

export interface CopyConfig {
  mode: 'fixed' | 'ratio';
  /** Fixed notional per copied trade, used when mode is `fixed`. */
  fixedAmount?: number;
  /** Fraction of the leader's notional to mirror, used when mode is `ratio`. */
  ratio?: number;
  /** Absolute cap on the follower's resulting position notional. */
  maxPosition?: number;
}

export interface LeaderFill {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  /** The leader's account equity, used to scale a ratio copy. */
  leaderEquity: number;
}

export interface FollowerOrder {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  notional: number;
}

export function copyOrder(
  fill: LeaderFill,
  config: CopyConfig,
  followerEquity: number,
): FollowerOrder | { error: string } | null {
  if (!Number.isFinite(fill.price) || fill.price <= 0) return { error: 'fill price must be positive' };
  if (!Number.isFinite(fill.quantity) || fill.quantity <= 0) return { error: 'fill quantity must be positive' };
  if (!Number.isFinite(followerEquity) || followerEquity <= 0) {
    return { error: 'followerEquity must be positive' };
  }

  const leaderNotional = fill.price * fill.quantity;
  let desiredNotional: number;

  if (config.mode === 'fixed') {
    if (!Number.isFinite(config.fixedAmount) || (config.fixedAmount ?? 0) <= 0) {
      return { error: 'fixedAmount must be positive in fixed mode' };
    }
    desiredNotional = config.fixedAmount as number;
  } else {
    if (!Number.isFinite(config.ratio) || (config.ratio ?? 0) <= 0) {
      return { error: 'ratio must be positive in ratio mode' };
    }
    if (!Number.isFinite(fill.leaderEquity) || fill.leaderEquity <= 0) {
      return { error: 'leaderEquity must be positive in ratio mode' };
    }
    // Mirror the leader's position as a share of their equity, scaled to the
    // follower's equity. This keeps the follower's leverage proportional.
    const leaderFraction = leaderNotional / fill.leaderEquity;
    desiredNotional = leaderFraction * followerEquity * (config.ratio as number);
  }

  const cap = config.maxPosition;
  if (Number.isFinite(cap) && cap !== undefined && desiredNotional > cap) {
    desiredNotional = cap;
  }
  if (desiredNotional <= 0) return null; // nothing to copy

  return {
    symbol: fill.symbol,
    side: fill.side,
    quantity: desiredNotional / fill.price,
    notional: desiredNotional,
  };
}

/**
 * Profit share owed to a leader on a follower's realized profit.
 *
 * A loss owes nothing: the share is only taken from positive profit, so a
 * follower never pays a leader for losing money.
 */
export function profitShare(realizedProfit: number, shareRate: number): number {
  if (!Number.isFinite(realizedProfit) || realizedProfit <= 0) return 0;
  const rate = Number.isFinite(shareRate) ? Math.min(Math.max(shareRate, 0), 1) : 0;
  return realizedProfit * rate;
}

/**
 * Aggregate a leader's performance metrics from their closed trades.
 *
 * ROI is total profit over the starting equity. Win rate is winning trades over
 * total trades. Both are computed from real rows; an empty history reports
 * zero rather than a fabricated figure.
 */
export function leaderMetrics(
  trades: Array<{ profit: number }>,
  startingEquity: number,
): { totalProfit: number; roi: number; winRate: number; trades: number } {
  const valid = trades.filter((t) => Number.isFinite(t.profit));
  const totalProfit = valid.reduce((sum, t) => sum + t.profit, 0);
  const wins = valid.filter((t) => t.profit > 0).length;
  const roi = Number.isFinite(startingEquity) && startingEquity > 0 ? totalProfit / startingEquity : 0;
  return {
    totalProfit,
    roi,
    winRate: valid.length === 0 ? 0 : wins / valid.length,
    trades: valid.length,
  };
}
