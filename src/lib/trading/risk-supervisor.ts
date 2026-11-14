/**
 * Liquidation supervisor.
 *
 * Two steps, both driven by real rows:
 *
 *  1. `scanPositions` re-prices every open position at the venue's current mark
 *     and asks the pure risk engine whether it has breached maintenance margin.
 *     A breaching position is marked `liquidating` and an instruction is placed
 *     on `liquidation_queue` exactly once.
 *  2. `processQueue` executes a pending instruction by force-closing the
 *     position at the mark. A close that exhausts the position's margin draws
 *     on the contract's insurance fund; a close that leaves a surplus credits it
 *     back. Both movements are written to the ledger and the queue entry is
 *     stamped executed with the outcome.
 *
 * Nothing is estimated: a position whose mark cannot be computed is skipped and
 * reported, never liquidated on a guess.
 */

import { getDb, generateId } from '@/lib/db';
import { consumeLocked, recordTransaction, LedgerError } from '@/lib/db/ledger';
import { recordFuturesLiquidation } from '@/lib/db/accounting';
import { positionRisk } from '@/lib/risk/engine';
import { riskTiers, markPriceFor, FuturesError } from '@/lib/trading/futures-engine';
import { isInverseContract, notionalUsd, unrealizedPnl } from '@/lib/trading/contract-math';

export interface PositionRow {
  position_id: string;
  user_id: string;
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  mark_price: number;
  leverage: number;
  margin_mode: string;
  margin: number;
  liquidation_price: number;
  status: string;
}

interface MarketRow {
  symbol: string;
  settlement_asset: string;
  contract_type: string;
  contract_size: number;
  maintenance_margin_rate: number;
}

/** Maintenance margin rate for a position's notional, honouring its risk tier. */
function maintenanceRate(market: MarketRow, notional: number): number {
  const tiers = riskTiers(market.symbol);
  for (const tier of [...tiers].sort((a, b) => a.tier - b.tier)) {
    if (notional <= tier.maxPositionNotional) return tier.maintenanceMarginRate;
  }
  return Number(market.maintenance_margin_rate);
}

export interface ScanResult {
  scanned: number;
  unpriced: string[];
  queued: Array<{ positionId: string; symbol: string; marginRatio: number }>;
}

/**
 * Re-price every open position and enqueue the ones that have breached.
 *
 * A position already carrying a pending queue entry is not enqueued twice.
 */
export function scanPositions(): ScanResult {
  const db = getDb();
  const markets = new Map<string, MarketRow>();
  for (const row of db
    .prepare('SELECT symbol, settlement_asset, contract_type, contract_size, maintenance_margin_rate FROM futures_markets')
    .all() as MarketRow[]) {
    markets.set(row.symbol, row);
  }

  const positions = db
    .prepare("SELECT * FROM futures_positions WHERE status = 'open'")
    .all() as PositionRow[];

  const result: ScanResult = { scanned: positions.length, unpriced: [], queued: [] };

  for (const position of positions) {
    const market = markets.get(position.symbol);
    if (!market) {
      result.unpriced.push(position.position_id);
      continue;
    }

    const mark = markPriceFor(position.symbol);
    if (mark === null) {
      result.unpriced.push(position.position_id);
      continue;
    }

    const contractSize = Number(market.contract_size) || 1;
    const inverse = isInverseContract(market.contract_type);
    const notional = notionalUsd(Number(position.quantity), mark, contractSize, inverse);
    const risk = positionRisk({
      side: position.side === 'short' ? 'short' : 'long',
      quantity: Number(position.quantity),
      entryPrice: Number(position.entry_price),
      markPrice: mark,
      leverage: Number(position.leverage),
      margin: Number(position.margin),
      maintenanceMarginRate: maintenanceRate(market, notional),
      contractSize,
      inverse,
    });

    if ('error' in risk) {
      result.unpriced.push(position.position_id);
      continue;
    }

    // Keep the stored mark and unrealized P&L current for every position, not
    // only the liquidatable ones, so the risk dashboard reads live figures.
    db.prepare(
      "UPDATE futures_positions SET mark_price = ?, unrealized_pnl = ?, updated_at = datetime('now') WHERE position_id = ?",
    ).run(mark, risk.unrealizedPnl, position.position_id);

    if (!risk.liquidatable) continue;

    const pending = db
      .prepare("SELECT 1 FROM liquidation_queue WHERE user_id = ? AND symbol = ? AND status IN ('pending', 'claimed')")
      .get(position.user_id, position.symbol);
    if (pending) continue;

    const entryId = generateId();
    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO liquidation_queue
           (entry_id, user_id, symbol, position_type, quantity, entry_price, mark_price, margin_ratio, status)
         VALUES (?, ?, ?, 'futures', ?, ?, ?, ?, 'pending')`,
      ).run(
        entryId,
        position.user_id,
        position.symbol,
        Number(position.quantity),
        Number(position.entry_price),
        mark,
        risk.marginRatio,
      );
      db.prepare("UPDATE futures_positions SET status = 'liquidating' WHERE position_id = ?").run(position.position_id);
    });
    run();

    result.queued.push({ positionId: position.position_id, symbol: position.symbol, marginRatio: risk.marginRatio });
  }

  return result;
}

export interface ProcessResult {
  processed: Array<{
    entryId: string;
    positionId: string;
    symbol: string;
    closedQuantity: number;
    insuranceDraw: number;
    insuranceCredit: number;
  }>;
  skipped: string[];
}

/**
 * Execute pending liquidation instructions.
 *
 * `limit` bounds how many entries are processed in one pass so a large backlog
 * cannot monopolise the database lock.
 */
export function processQueue(limit = 50): ProcessResult {
  const db = getDb();
  const entries = db
    .prepare("SELECT * FROM liquidation_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 500)) as Array<{
    entry_id: string;
    user_id: string;
    symbol: string;
  }>;

  const result: ProcessResult = { processed: [], skipped: [] };

  for (const entry of entries) {
    const position = db
      .prepare("SELECT * FROM futures_positions WHERE user_id = ? AND symbol = ? AND status = 'liquidating'")
      .get(entry.user_id, entry.symbol) as PositionRow | undefined;

    if (!position) {
      db.prepare("UPDATE liquidation_queue SET status = 'cancelled' WHERE entry_id = ?").run(entry.entry_id);
      result.skipped.push(entry.entry_id);
      continue;
    }

    const market = db
      .prepare('SELECT symbol, settlement_asset, contract_type, contract_size, maintenance_margin_rate FROM futures_markets WHERE symbol = ?')
      .get(entry.symbol) as MarketRow | undefined;
    if (!market) {
      result.skipped.push(entry.entry_id);
      continue;
    }

    const mark = markPriceFor(entry.symbol);
    if (mark === null) {
      result.skipped.push(entry.entry_id);
      continue;
    }

    const settlement = market.settlement_asset;
    const contractSize = Number(market.contract_size) || 1;
    const inverse = isInverseContract(market.contract_type);
    const quantity = Number(position.quantity);
    const grossPnl = unrealizedPnl({
      inverse,
      side: position.side === 'long' ? 'long' : 'short',
      quantity,
      entryPrice: Number(position.entry_price),
      markPrice: mark,
      contractSize,
    });
    const margin = Number(position.margin);

    // The margin is consumed to cover the loss; whatever the loss exceeds is a
    // draw on the insurance fund, and whatever the margin exceeds is credited
    // back to the fund as a bankruptcy surplus.
    const fund = db.prepare('SELECT balance FROM insurance_funds WHERE contract = ?').get(entry.symbol) as
      | { balance: number }
      | undefined;
    if (!fund) {
      db.prepare('INSERT INTO insurance_funds (contract, balance) VALUES (?, 0)').run(entry.symbol);
    }

    const insuranceDraw = Math.max(0, -(grossPnl + margin));
    const insuranceCredit = Math.max(0, grossPnl + margin);

    try {
      const run = db.transaction(() => {
        consumeLocked(position.user_id, settlement, margin);
        // The margin is consumed, the loss is the venue pool's gain, and the
        // insurance fund covers whatever the margin could not.
        recordFuturesLiquidation(
          position.user_id,
          settlement,
          entry.symbol,
          margin,
          grossPnl,
          `Liquidated ${position.side} ${quantity} ${entry.symbol}`,
        );
        if (insuranceDraw > 0) {
          db.prepare(
            "UPDATE insurance_funds SET balance = MAX(0, balance - ?), updated_at = datetime('now') WHERE contract = ?",
          ).run(insuranceDraw, entry.symbol);
        } else if (insuranceCredit > 0) {
          db.prepare(
            "UPDATE insurance_funds SET balance = balance + ?, updated_at = datetime('now') WHERE contract = ?",
          ).run(insuranceCredit, entry.symbol);
        }

        db.prepare(
          `UPDATE futures_positions
              SET quantity = 0, margin = 0, mark_price = ?, realized_pnl = realized_pnl + ?,
                  status = 'liquidated', updated_at = datetime('now')
            WHERE position_id = ?`,
        ).run(mark, grossPnl, position.position_id);

        db.prepare("UPDATE liquidation_queue SET status = 'executed', executed_at = datetime('now') WHERE entry_id = ?").run(
          entry.entry_id,
        );

        recordTransaction(
          position.user_id,
          'futures_liquidation',
          settlement,
          quantity,
          0,
          'completed',
          `Liquidated ${position.side} ${quantity} ${entry.symbol} at ${mark}`,
        );
      });
      run();
    } catch (error) {
      if (error instanceof LedgerError) throw new FuturesError(error.code, error.message, error.status);
      throw error;
    }

    result.processed.push({
      entryId: entry.entry_id,
      positionId: position.position_id,
      symbol: entry.symbol,
      closedQuantity: quantity,
      insuranceDraw,
      insuranceCredit,
    });
  }

  return result;
}
