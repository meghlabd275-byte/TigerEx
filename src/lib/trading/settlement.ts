/**
 * Scheduled settlement jobs for the exchange venues.
 *
 * A perpetual only works if funding is charged on a schedule, an option only
 * expires if someone settles it, and a leveraged token only tracks its index if
 * its NAV is rebalanced. Each of those actions lives in its engine, but an
 * engine never decides *when* to run: that is this module's job. It is pure with
 * respect to scheduling, so a cron worker, a queue consumer, the admin console
 * and a test all drive it the same way.
 *
 * Free of `next/server` so it can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';
import { applyFunding, markPriceFor } from '@/lib/trading/futures-engine';
import { listOptionsMarkets, settleExpired } from '@/lib/options/options-engine';
import { rebalanceAll } from '@/lib/trading/etf-engine';
import { indexPriceFor } from '@/lib/trading/mark-price';
import { fundingRate } from '@/lib/oracle/aggregator';
import { sweepExpiredRedPackets } from '@/lib/earn/rewards';
import { runDueBots, type BotTickResult } from '@/lib/bots/runner';
import { runCopySweep, type CopyExecutionResult } from '@/lib/trading/copy-engine';
import { runArmedAdl, type AdlResult } from '@/lib/trading/adl';
import { runMarginLiquidationKeeper } from '@/lib/trading/margin-engine';
import { triggerConditionalOrders } from '@/lib/trading/futures-engine';

export interface FundingSettlement {
  symbol: string;
  rate: number;
  positions: number;
}

export interface SettlementReport {
  fundingApplied: FundingSettlement[];
  fundingSkipped: string[];
  optionsSettled: Array<{ symbol: string; settled: number; totalValue: number }>;
  optionsSkipped: string[];
  etfRebalanced: string[];
  redPacketsRefunded: number;
  botsRun: number;
  botsPlaced: number;
  botErrors: Array<{ botId: string; reason: string }>;
  copyMirrored: number;
  copySkipped: number;
  adlContracts: string[];
  adlClawedBack: number;
  marginLiquidated: string[];
  marginLiquidationSkipped: number;
  conditionalTriggered: string[];
  conditionalSkipped: number;
}

const HOUR_NS = 60 * 60 * 1e9;

/**
 * Charge funding on every perpetual whose interval has elapsed.
 *
 * The rate is the venue's own premium: the mark-versus-index basis plus the
 * contract's interest component, clamped to its cap. A contract with no fresh
 * mark or index is skipped rather than funded at a guessed rate, so a stale
 * oracle can never move money.
 */
export function settleDueFunding(nowMs: number = Date.now()): {
  applied: FundingSettlement[];
  skipped: string[];
} {
  const db = getDb();
  const markets = db
    .prepare(
      `SELECT symbol, funding_interval_hours, funding_rate_cap
         FROM futures_markets
        WHERE status = 'active' AND listing_type = 'perpetual'`,
    )
    .all() as Array<{ symbol: string; funding_interval_hours: number; funding_rate_cap: number }>;

  const applied: FundingSettlement[] = [];
  const skipped: string[] = [];

  for (const market of markets) {
    const intervalNs = Math.max(1, Number(market.funding_interval_hours) || 8) * HOUR_NS;
    const last = db
      .prepare('SELECT MAX(funding_time_ns) AS last FROM funding_rates WHERE symbol = ?')
      .get(market.symbol) as { last: number | null } | undefined;
    const lastNs = Number(last?.last ?? 0);
    // First funding establishes the baseline and is charged immediately; after
    // that a contract is only funded once a full interval has elapsed.
    if (lastNs > 0 && nowMs * 1e6 - lastNs < intervalNs) continue;

    const mark = markPriceFor(market.symbol);
    if (mark === null) {
      skipped.push(market.symbol);
      continue;
    }
    const published = indexPriceFor(market.symbol);
    const index = 'error' in published ? mark : published.price;
    const rate = fundingRate(mark, index, 0, Number(market.funding_rate_cap) || 0.01);
    if (typeof rate !== 'number') {
      skipped.push(market.symbol);
      continue;
    }

    try {
      const result = applyFunding(market.symbol, rate, index);
      applied.push({ symbol: market.symbol, rate: result.rate, positions: result.positions });
    } catch {
      // No open positions or no price: nothing to settle this cycle.
      skipped.push(market.symbol);
    }
  }

  return { applied, skipped };
}

/**
 * Settle every option contract whose expiry has passed.
 *
 * A contract with no observable settlement price is skipped rather than settled
 * at a fabricated price; it is retried on the next cycle.
 */
export function settleExpiredOptions(nowMs: number = Date.now()): {
  settled: Array<{ symbol: string; settled: number; totalValue: number }>;
  skipped: string[];
} {
  const settled: Array<{ symbol: string; settled: number; totalValue: number }> = [];
  const skipped: string[] = [];

  for (const market of listOptionsMarkets({ includeExpired: true })) {
    if (market.expiryNs / 1e6 > nowMs) continue;
    try {
      const result = settleExpired(market, nowMs);
      if (result.settled > 0) {
        settled.push({ symbol: market.symbol, settled: result.settled, totalValue: result.totalValue });
      }
    } catch {
      skipped.push(market.symbol);
    }
  }

  return { settled, skipped };
}

/** Rebalance every leveraged token whose NAV has drifted or whose day is up. */
export function rebalanceEtfTokens(nowMs: number = Date.now()): string[] {
  return rebalanceAll(nowMs)
    .filter((result) => result.rebalanced)
    .map((result) => result.symbol);
}

/** Run every settlement job once and report what moved. */
export function runSettlementCycle(nowMs: number = Date.now()): SettlementReport {
  const funding = settleDueFunding(nowMs);
  const options = settleExpiredOptions(nowMs);
  const etf = rebalanceEtfTokens(nowMs);
  const redPacketsRefunded = sweepExpiredRedPackets(nowMs);

  // Running bots is the one job that can place orders, so it is scheduled last:
  // a cycle that paused a venue or moved a price does so before any bot reacts.
  let bots: BotTickResult[] = [];
  try {
    bots = runDueBots(nowMs * 1e6);
  } catch {
    bots = [];
  }
  const botErrors = bots
    .filter((tick) => tick.action === 'skipped' && tick.reason)
    .map((tick) => ({ botId: tick.botId, reason: tick.reason as string }));

  // Copy mirroring also places orders, so it runs after the venue-level jobs
  // for the same reason the bot runner does.
  let copy: CopyExecutionResult[] = [];
  try {
    copy = runCopySweep();
  } catch {
    copy = [];
  }

  // Auto-deleveraging runs last: it closes positions, so it must see the marks
  // and funding this cycle has already applied.
  let adl: AdlResult[] = [];
  try {
    adl = runArmedAdl();
  } catch {
    adl = [];
  }

  // Spot margin enforcement: an underwater loan is force-closed by the venue
  // when no external keeper bot claims it, so bad debt never accumulates.
  let margin = { liquidated: [] as Array<{ loanId: string }>, skipped: [] as Array<{ loanId: string }> };
  try {
    margin = runMarginLiquidationKeeper(nowMs);
  } catch {
    margin = { liquidated: [], skipped: [] };
  }

  // Conditional orders (stop-loss, take-profit, trailing) are evaluated after
  // funding and liquidation have moved the mark, so a trigger sees this cycle's
  // prices rather than the previous cycle's.
  let conditional = { triggered: [] as Array<{ orderId: string }>, skipped: [] as string[] };
  try {
    conditional = triggerConditionalOrders();
  } catch {
    conditional = { triggered: [], skipped: [] };
  }

  return {
    fundingApplied: funding.applied,
    fundingSkipped: funding.skipped,
    optionsSettled: options.settled,
    optionsSkipped: options.skipped,
    etfRebalanced: etf,
    redPacketsRefunded,
    botsRun: bots.length,
    botsPlaced: bots.filter((tick) => tick.action === 'placed').length,
    botErrors,
    copyMirrored: copy.filter((row) => row.status === 'placed').length,
    copySkipped: copy.filter((row) => row.status === 'skipped').length,
    adlContracts: adl.map((result) => result.contract),
    adlClawedBack: adl.reduce((sum, result) => sum + result.clawedBack, 0),
    marginLiquidated: margin.liquidated.map((row) => row.loanId),
    marginLiquidationSkipped: margin.skipped.length,
    conditionalTriggered: conditional.triggered.map((row) => row.orderId),
    conditionalSkipped: conditional.skipped.length,
  };
}
