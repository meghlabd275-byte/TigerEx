/**
 * Auto-deleveraging (ADL).
 *
 * When a contract's insurance fund falls below its ADL threshold it can no
 * longer absorb a bankrupt position's loss. The exchange then closes the
 * opposing, profitable positions — most profitable and most leveraged first —
 * and takes the profit those positions would have realised, refilling the fund
 * to its target. This is the same last-resort mechanism every derivatives venue
 * runs; it is triggered only by a real fund shortfall, never speculatively.
 *
 * Every movement is written to the ledger, so a deleveraged trader's margin
 * return, the profit the fund took and the fund's new balance all reconcile.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';
import { consumeLocked, creditAvailable, recordTransaction, LedgerError } from '@/lib/db/ledger';
import { adlQueue, insuranceFundStatus, type AdlPosition } from '@/lib/risk/engine';
import { markPriceFor } from '@/lib/trading/futures-engine';

export class AdlError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

interface AdlRow {
  position_id: string;
  user_id: string;
  side: string;
  quantity: number;
  entry_price: number;
  margin: number;
  leverage: number;
}

export interface AdlReduction {
  positionId: string;
  userId: string;
  side: string;
  closedQuantity: number;
  realizedProfit: number;
  clawback: number;
  paidOut: number;
}

export interface AdlResult {
  contract: string;
  ran: boolean;
  reason?: string;
  deficit: number;
  clawedBack: number;
  fundBalance: number;
  reductions: AdlReduction[];
}

/**
 * Run auto-deleveraging for one contract.
 *
 * The deficit is the gap between the fund's target and its balance. Profitable
 * opposing positions are closed until their combined profit covers it, and each
 * position gives up its share of the deficit while keeping the rest. A contract
 * whose fund is healthy, disabled, or short of profitable positions does
 * nothing and says why.
 */
export function runAdl(contract: string): AdlResult {
  const db = getDb();
  const fund = db
    .prepare('SELECT balance, target_balance, adl_enabled, adl_threshold FROM insurance_funds WHERE contract = ?')
    .get(contract) as
    | { balance: number; target_balance: number; adl_enabled: number; adl_threshold: number }
    | undefined;

  if (!fund) throw new AdlError('UNKNOWN_FUND', `No insurance fund for ${contract}`, 404);
  if (fund.adl_enabled !== 1) {
    return { contract, ran: false, reason: 'adl disabled', deficit: 0, clawedBack: 0, fundBalance: Number(fund.balance), reductions: [] };
  }

  const status = insuranceFundStatus(Number(fund.balance), Number(fund.target_balance), Number(fund.adl_threshold));
  if (!status.adlArmed) {
    return {
      contract,
      ran: false,
      reason: 'fund is above its adl threshold',
      deficit: 0,
      clawedBack: 0,
      fundBalance: Number(fund.balance),
      reductions: [],
    };
  }

  const deficit = Math.max(0, Number(fund.target_balance) - Number(fund.balance));

  const mark = markPriceFor(contract);
  if (mark === null) throw new AdlError('NO_PRICE', `No mark price for ${contract}`, 409);

  const market = db
    .prepare('SELECT settlement_asset, contract_size FROM futures_markets WHERE symbol = ?')
    .get(contract) as { settlement_asset: string; contract_size: number } | undefined;
  if (!market) throw new AdlError('UNKNOWN_MARKET', `No market for ${contract}`, 404);
  const settlement = market.settlement_asset;
  const contractSize = Number(market.contract_size) || 1;

  const rows = db
    .prepare(
      `SELECT position_id, user_id, side, quantity, entry_price, margin, leverage
         FROM futures_positions
        WHERE symbol = ? AND status = 'open' AND quantity > 0`,
    )
    .all(contract) as AdlRow[];

  // A position's profit is its unrealised PnL at the current mark; the ratio of
  // that to its margin is the ADL priority the pure engine sorts on.
  const withProfit = rows
    .map((row) => {
      const direction = row.side === 'long' ? 1 : -1;
      const profit = (mark - Number(row.entry_price)) * Number(row.quantity) * direction * contractSize;
      const margin = Number(row.margin);
      return { row, profit, pnlRatio: margin > 0 ? profit / margin : 0 };
    })
    .filter((entry) => entry.profit > 0);

  if (withProfit.length === 0) {
    return { contract, ran: false, reason: 'no profitable positions to deleverage', deficit, clawedBack: 0, fundBalance: Number(fund.balance), reductions: [] };
  }

  const queue = adlQueue(
    withProfit.map((entry) => ({
      userId: entry.row.user_id,
      side: entry.row.side === 'short' ? ('short' as const) : ('long' as const),
      notional: Number(entry.row.quantity) * mark * contractSize,
      leverage: Number(entry.row.leverage),
      pnlRatio: entry.pnlRatio,
      row: entry.row,
      profit: entry.profit,
    })),
  ) as unknown as Array<AdlPosition & { row: AdlRow; profit: number }>;

  // Close positions until their combined profit covers the deficit.
  const selected: typeof queue = [];
  let covered = 0;
  for (const entry of queue) {
    selected.push(entry);
    covered += entry.profit;
    if (covered >= deficit) break;
  }
  const clawbackRate = covered > 0 ? Math.min(1, deficit / covered) : 0;

  const reductions: AdlReduction[] = [];
  let clawedBack = 0;
  try {
    const run = db.transaction(() => {
      for (const entry of selected) {
        const margin = Number(entry.row.margin);
        const clawback = entry.profit * clawbackRate;
        const paidOut = entry.profit - clawback;

        // The margin the position posted returns, plus whatever profit the
        // deleveraging left it; the fund keeps the clawback.
        consumeLocked(entry.row.user_id, settlement, margin);
        creditAvailable(entry.row.user_id, settlement, margin + paidOut);

        db.prepare(
          `UPDATE futures_positions
              SET quantity = 0, margin = 0, mark_price = ?, realized_pnl = realized_pnl + ?,
                  status = 'adl', updated_at = datetime('now')
            WHERE position_id = ?`,
        ).run(mark, paidOut, entry.row.position_id);

        db.prepare(
          "UPDATE insurance_funds SET balance = balance + ?, updated_at = datetime('now') WHERE contract = ?",
        ).run(clawback, contract);

        recordTransaction(
          entry.row.user_id,
          'futures_adl',
          settlement,
          Number(entry.row.quantity),
          clawback,
          'completed',
          `ADL closed ${entry.row.side} ${entry.row.quantity} ${contract} at ${mark}`,
        );

        clawedBack += clawback;
        reductions.push({
          positionId: entry.row.position_id,
          userId: entry.row.user_id,
          side: entry.row.side,
          closedQuantity: Number(entry.row.quantity),
          realizedProfit: entry.profit,
          clawback,
          paidOut,
        });
      }
    });
    run();
  } catch (error) {
    if (error instanceof LedgerError) throw new AdlError(error.code, error.message, error.status);
    throw error;
  }

  const updated = db.prepare('SELECT balance FROM insurance_funds WHERE contract = ?').get(contract) as {
    balance: number;
  };

  return {
    contract,
    ran: true,
    deficit,
    clawedBack,
    fundBalance: Number(updated.balance),
    reductions,
  };
}

/**
 * Run ADL for every contract whose fund has armed it.
 *
 * Each contract is independent: one that cannot be priced or has no profitable
 * positions is reported and skipped without stopping the rest.
 */
export function runArmedAdl(): AdlResult[] {
  const db = getDb();
  const contracts = db
    .prepare('SELECT contract FROM insurance_funds WHERE adl_enabled = 1')
    .all() as Array<{ contract: string }>;

  const results: AdlResult[] = [];
  for (const { contract } of contracts) {
    try {
      const result = runAdl(contract);
      if (result.ran) results.push(result);
    } catch {
      // A contract with no mark or no market is skipped this cycle.
    }
  }
  return results;
}
