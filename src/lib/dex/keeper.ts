/**
 * TigerSwap keeper.
 *
 * The keeper is the part of the venue that acts on standing instructions: it
 * settles limit orders whose price has crossed, runs the slices of DCA and TWAP
 * plans that have come due, applies funding to open perpetuals and liquidates
 * the ones that have fallen below their maintenance margin. Every action goes
 * through the same settlement services the API uses, so a keeper-driven trade
 * moves balances exactly as a user-driven one does.
 *
 * The functions are pure with respect to scheduling: the caller decides when to
 * run them, so the same code serves a cron worker, a queue consumer or a test.
 */

import { getDb } from '@/lib/db';
import { parseUtcTimestamp } from '@/lib/trading/candles';
import { executeSwap } from '@/lib/dex/swap-service';
import { closePosition, applyFunding, liquidatePosition, markPrice, perpPositions } from '@/lib/dex/perps-service';
import { accrueInterest } from '@/lib/dex/margin-service';
import { distributeVetgrFees } from '@/lib/dex/farm-service';
import { dcaSlicesDue, twapChildren, limitShouldTrigger } from '@/lib/dex/orders';
import { shouldLiquidate } from '@/lib/dex/perps';
import { loadPool, parseObject, parseStringArray } from '@/lib/dex/pool-service';
import { priceInQuote } from '@/lib/trading/valuation';

export interface KeeperReport {
  limitOrdersSettled: number;
  limitOrdersFailed: number;
  dcaSlicesRun: number;
  dcaSlicesFailed: number;
  twapSlicesRun: number;
  twapSlicesFailed: number;
  fundingApplied: string[];
  positionsLiquidated: number;
  interestAccrued: number;
  vetgrFeesDistributed: number;
}

/** The current spot price of a pair, from the deepest pool that serves it. */
function spotPrice(poolId: string, tokenIn: string, tokenOut: string): number | null {
  try {
    const row = loadPool(poolId);
    const tokens = parseStringArray(row.tokens, 'tokens');
    const reserves = parseObject(row.reserves, 'reserves');
    if (row.kind === 'v2' && tokens.length === 2) {
      const [a, b] = tokens;
      if (tokenIn === a && tokenOut === b) return reserves[b] / reserves[a];
      if (tokenIn === b && tokenOut === a) return reserves[a] / reserves[b];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Settle every open limit order whose limit price has been reached.
 *
 * A buy triggers when the market price is at or below the limit; a sell when it
 * is at or above. The settlement is a real swap, so a failed swap (insufficient
 * balance, pool paused) leaves the order open for the next cycle.
 */
export function settleDueLimitOrders(): { settled: number; failed: number } {
  const db = getDb();
  const orders = db
    .prepare("SELECT * FROM dex_limit_orders WHERE status = 'open' ORDER BY created_at LIMIT 200")
    .all() as Array<{
    order_id: string;
    pool_id: string;
    user_id: string;
    side: string;
    token_in: string;
    token_out: string;
    amount_in: number;
    limit_price: number;
  }>;

  let settled = 0;
  let failed = 0;
  for (const order of orders) {
    const price = spotPrice(order.pool_id, order.token_in, order.token_out);
    if (price === null) continue;
    if (!limitShouldTrigger({ side: order.side as 'buy' | 'sell', limitPrice: order.limit_price }, price)) continue;

    try {
      const result = executeSwap({
        userId: order.user_id,
        tokenIn: order.token_in,
        tokenOut: order.token_out,
        amountIn: order.amount_in,
      });
      db.prepare("UPDATE dex_limit_orders SET status = 'filled', filled_amount_out = ?, updated_at = datetime('now') WHERE order_id = ?").run(
        result.amountOut,
        order.order_id,
      );
      settled += 1;
    } catch {
      failed += 1;
    }
  }
  return { settled, failed };
}

/** Run every DCA slice that has come due since a plan's last run. */
export function runDueDcaPlans(now = Date.now()): { run: number; failed: number } {
  const db = getDb();
  const plans = db
    .prepare("SELECT * FROM dex_dca_plans WHERE status = 'active'")
    .all() as Array<{
    plan_id: string;
    user_id: string;
    pool_id: string;
    token_in: string;
    token_out: string;
    amount_per_slice: number;
    frequency: string;
    total_slices: number;
    executed_slices: number;
    start_at: string;
    last_run_at: string | null;
  }>;

  let run = 0;
  let failed = 0;
  for (const plan of plans) {
    const startAt = parseUtcTimestamp(plan.start_at);
    const due = dcaSlicesDue(
      {
        poolId: plan.pool_id,
        tokenIn: plan.token_in,
        tokenOut: plan.token_out,
        amountPerSlice: plan.amount_per_slice,
        frequency: plan.frequency as never,
        totalSlices: plan.total_slices,
        startAt,
      },
      now,
    );
    const outstanding = due - plan.executed_slices;
    if (outstanding <= 0) continue;

    // The progress counter is per plan; a shared counter would credit one
    // plan's slices to the next one in the loop.
    let executed = plan.executed_slices;
    for (let i = 0; i < outstanding; i += 1) {
      try {
        executeSwap({
          userId: plan.user_id,
          tokenIn: plan.token_in,
          tokenOut: plan.token_out,
          amountIn: plan.amount_per_slice,
        });
        run += 1;
        executed += 1;
      } catch {
        failed += 1;
        break;
      }
    }
    // A plan with total_slices = 0 runs until it is cancelled, so it is never
    // completed by reaching a slice count.
    const status = plan.total_slices > 0 && executed >= plan.total_slices ? 'completed' : 'active';
    db.prepare("UPDATE dex_dca_plans SET executed_slices = ?, last_run_at = ?, status = ? WHERE plan_id = ?").run(
      Math.min(executed, plan.total_slices),
      new Date(now).toISOString(),
      status,
      plan.plan_id,
    );
  }
  return { run, failed };
}

/** Run every TWAP slice that has come due since a plan started. */
export function runDueTwapPlans(now = Date.now()): { run: number; failed: number } {
  const db = getDb();
  const plans = db
    .prepare("SELECT * FROM dex_twap_plans WHERE status = 'active'")
    .all() as Array<{
    plan_id: string;
    user_id: string;
    pool_id: string;
    token_in: string;
    token_out: string;
    total_amount_in: number;
    slices: number;
    interval_ms: number;
    executed_slices: number;
    start_at: string;
  }>;

  let run = 0;
  let failed = 0;
  for (const plan of plans) {
    const children = twapChildren({
      poolId: plan.pool_id,
      tokenIn: plan.token_in,
      tokenOut: plan.token_out,
      totalAmountIn: plan.total_amount_in,
      slices: plan.slices,
      intervalMs: plan.interval_ms,
      startAt: parseUtcTimestamp(plan.start_at),
    });
    const due = children.filter((child) => child.releaseAt <= now).length;
    const outstanding = due - plan.executed_slices;
    if (outstanding <= 0) continue;

    let executed = plan.executed_slices;
    for (let i = 0; i < outstanding; i += 1) {
      const child = children[executed];
      if (!child) break;
      try {
        executeSwap({ userId: plan.user_id, tokenIn: plan.token_in, tokenOut: plan.token_out, amountIn: child.amountIn });
        run += 1;
        executed += 1;
      } catch {
        failed += 1;
        break;
      }
    }
    const status = executed >= plan.slices ? 'completed' : 'active';
    db.prepare('UPDATE dex_twap_plans SET executed_slices = ?, status = ? WHERE plan_id = ?').run(
      Math.min(executed, plan.slices),
      status,
      plan.plan_id,
    );
  }
  return { run, failed };
}

/**
 * Apply funding to every listed perpetual and liquidate any position that the
 * mark price has pushed below its maintenance margin.
 */
export function runPerpCycle(): { fundingApplied: string[]; liquidated: number } {
  const db = getDb();
  const markets = db
    .prepare(
      "SELECT symbol, funding_rate_cap, maintenance_margin_rate FROM futures_markets WHERE status = 'active'",
    )
    .all() as Array<{
    symbol: string;
    funding_rate_cap: number;
    maintenance_margin_rate: number;
  }>;

  const fundingApplied: string[] = [];
  let liquidated = 0;

  for (const market of markets) {
    // The funding rate is derived from the mark/index basis by the oracle
    // module; when no fresh sources exist the market is skipped rather than
    // funded at a guessed rate.
    let rate: number;
    try {
      rate = fundingRateFor(market.symbol, market.funding_rate_cap);
    } catch {
      continue;
    }
    try {
      applyFunding(market.symbol, rate);
      fundingApplied.push(market.symbol);
    } catch {
      // A market with no open positions or no price is skipped.
    }

    const open = db
      .prepare("SELECT position_id, user_id, side, size, entry_price, collateral FROM dex_perp_positions WHERE market = ? AND status = 'open'")
      .all(market.symbol) as Array<{ position_id: string; side: string; size: number; entry_price: number; collateral: number }>;
    for (const position of open) {
      let mark: number;
      try {
        mark = markPrice(market.symbol);
      } catch {
        continue;
      }
      if (shouldLiquidate(position.side as 'long' | 'short', position.size, position.entry_price, mark, position.collateral, market.maintenance_margin_rate)) {
        try {
          liquidatePosition(position.position_id, mark);
          liquidated += 1;
        } catch {
          // Already closed by the funding pass; skip.
        }
      }
    }
  }
  return { fundingApplied, liquidated };
}

/** The funding rate for a symbol from the stored oracle sources. */
function fundingRateFor(symbol: string, cap: number): number {
  const [base] = symbol.split('/');
  const index = priceInQuote(base, 'RUSD');
  if (index === null) throw new Error('no index price');
  const mark = markPrice(symbol);
  const premium = (mark - index) / index;
  return Math.max(-cap, Math.min(cap, premium / 8));
}

/** Run one full keeper cycle and return what it did. */
export function runKeeperCycle(now = Date.now()): KeeperReport {
  const limits = settleDueLimitOrders();
  const dca = runDueDcaPlans(now);
  const twap = runDueTwapPlans(now);
  const perps = runPerpCycle();
  const lending = accrueInterest(now);
  const vetgrFees = distributeVetgrFees();
  return {
    limitOrdersSettled: limits.settled,
    limitOrdersFailed: limits.failed,
    dcaSlicesRun: dca.run,
    dcaSlicesFailed: dca.failed,
    twapSlicesRun: twap.run,
    twapSlicesFailed: twap.failed,
    fundingApplied: perps.fundingApplied,
    positionsLiquidated: perps.liquidated,
    interestAccrued: lending.charged,
    vetgrFeesDistributed: vetgrFees.reduce((sum, entry) => sum + entry.distributed, 0),
  };
}

export { closePosition, perpPositions };
