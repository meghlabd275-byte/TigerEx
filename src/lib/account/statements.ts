/**
 * Account statements and tax reports.
 *
 * A user (and, on request, an operator acting for them) can export a period
 * statement of everything that moved on the account, and a tax report of
 * realised gains and fees. Both are built from the venue's own records —
 * `transactions` for movements, `spot_trades` for fills, and the double-entry
 * `journal_entries` for fees — and nothing is estimated or back-filled.
 *
 * The CSV writers are pure functions over the computed rows, so the exact bytes
 * a user downloads can be unit tested without a database.
 */

import { getDb } from '@/lib/db';
import { realizedPnl, type Fill } from '@/lib/db/pnl';

export class StatementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface Period {
  from: string;
  to: string;
}

export interface StatementLine {
  timestamp: string;
  type: string;
  asset: string;
  amount: number;
  fee: number;
  status: string;
  memo: string | null;
}

export interface Statement {
  userId: string;
  from: string;
  to: string;
  generatedAt: string;
  lines: StatementLine[];
  totalsByAsset: Array<{ asset: string; amount: number; fee: number }>;
}

export interface TaxLot {
  pairId: string;
  asset: string;
  realizedPnl: number;
  fees: number;
}

export interface TaxReport {
  userId: string;
  from: string;
  to: string;
  generatedAt: string;
  lots: TaxLot[];
  totalRealizedPnl: number;
  totalFees: number;
}

/**
 * Parse a period from `from`/`to` query values.
 *
 * Accepts an ISO date or a date-time. Defaults to the last 30 days when unset.
 * A period whose end precedes its start is refused rather than silently swapped,
 * so a caller cannot get a report for a window it did not ask for.
 */
export function parsePeriod(fromRaw: string | null, toRaw: string | null, now = new Date()): Period {
  const to = toRaw ? new Date(toRaw) : now;
  const from = fromRaw ? new Date(fromRaw) : new Date(now.getTime() - 30 * 24 * 3600_000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new StatementError('INVALID_PERIOD', 'The period is not a valid date range');
  }
  if (to.getTime() < from.getTime()) {
    throw new StatementError('INVALID_PERIOD', 'The period end must not precede its start');
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Build a statement for a user over a period, from the recorded movements. */
export function buildStatement(userId: string, period: Period): Statement {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT created_at, type, currency, amount, fee, status, memo
         FROM transactions
        WHERE user_id = ?
          AND datetime(created_at) >= datetime(?)
          AND datetime(created_at) <= datetime(?)
        ORDER BY datetime(created_at) ASC`,
    )
    .all(userId, period.from, period.to) as Array<{
    created_at: string;
    type: string;
    currency: string;
    amount: number;
    fee: number;
    status: string;
    memo: string | null;
  }>;

  const lines: StatementLine[] = rows.map((row) => ({
    timestamp: row.created_at,
    type: row.type,
    asset: row.currency,
    amount: Number(row.amount) || 0,
    fee: Number(row.fee) || 0,
    status: row.status,
    memo: row.memo,
  }));

  const totals = new Map<string, { amount: number; fee: number }>();
  for (const line of lines) {
    const current = totals.get(line.asset) ?? { amount: 0, fee: 0 };
    current.amount += line.amount;
    current.fee += line.fee;
    totals.set(line.asset, current);
  }

  return {
    userId,
    from: period.from,
    to: period.to,
    generatedAt: new Date().toISOString(),
    lines,
    totalsByAsset: [...totals.entries()]
      .map(([asset, value]) => ({ asset, amount: value.amount, fee: value.fee }))
      .sort((a, b) => a.asset.localeCompare(b.asset)),
  };
}

/**
 * Build a tax report for a user over a period.
 *
 * Realised P&L uses the average-cost method over the user's fills (see
 * `realizedPnl`), grouped by the pair's base asset. Fees are summed from the
 * same fills. A user with no fills gets an empty report, not a fabricated one.
 */
export function buildTaxReport(userId: string, period: Period): TaxReport {
  const db = getDb();
  const fills = db
    .prepare(
      `SELECT symbol, side, quantity, price, maker_fee, taker_fee, maker_user_id, taker_user_id, created_at
         FROM spot_trades
        WHERE (maker_user_id = ? OR taker_user_id = ?)
          AND datetime(created_at) >= datetime(?)
          AND datetime(created_at) <= datetime(?)
        ORDER BY datetime(created_at) ASC`,
    )
    .all(userId, userId, period.from, period.to) as Array<{
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    maker_fee: number;
    taker_fee: number;
    maker_user_id: string;
    taker_user_id: string;
    created_at: string;
  }>;

  // The trade's `side` is the taker's side; for a maker the sign is reversed.
  const pnlFills: Fill[] = fills.map((row) => {
    const isMaker = row.maker_user_id === userId;
    const side = isMaker ? (row.side === 'buy' ? 'sell' : 'buy') : row.side;
    return {
      pair_id: row.symbol,
      side,
      quantity: row.quantity,
      average_price: row.price,
      fee: isMaker ? row.maker_fee : row.taker_fee,
      created_at: row.created_at,
    };
  });

  // Realised P&L is computed per pair (the average-cost position is per pair),
  // then folded into the pair's base asset for the report. `realizedPnl` nets
  // fees into its total, so it is fed fee-free fills here and the fees are
  // reported in their own column instead of being counted twice.
  const fillsByPair = new Map<string, Fill[]>();
  for (const fill of pnlFills) {
    fillsByPair.set(fill.pair_id, [...(fillsByPair.get(fill.pair_id) ?? []), fill]);
  }

  const lots = new Map<string, TaxLot>();
  for (const [pairId, pairFills] of fillsByPair) {
    const asset = pairId.split('/')[0] ?? pairId;
    const lot = lots.get(asset) ?? { pairId: asset, asset, realizedPnl: 0, fees: 0 };
    lot.realizedPnl += realizedPnl(pairFills.map((fill) => ({ ...fill, fee: 0 }))).total;
    for (const fill of pairFills) lot.fees += fill.fee;
    lots.set(asset, lot);
  }
  const total = [...lots.values()].reduce((sum, lot) => sum + lot.realizedPnl, 0);

  const list = [...lots.values()].sort((a, b) => a.asset.localeCompare(b.asset));
  return {
    userId,
    from: period.from,
    to: period.to,
    generatedAt: new Date().toISOString(),
    lots: list,
    totalRealizedPnl: total,
    totalFees: pnlFills.reduce((sum, fill) => sum + fill.fee, 0),
  };
}

/** Escape a CSV field: quote when it contains a comma, quote or newline. */
export function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Serialise statement lines to CSV. Pure, so the bytes are testable. */
export function statementToCsv(statement: Statement): string {
  const header = ['timestamp', 'type', 'asset', 'amount', 'fee', 'status', 'memo'];
  const rows = statement.lines.map((line) =>
    [line.timestamp, line.type, line.asset, line.amount, line.fee, line.status, line.memo ?? '']
      .map(csvField)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

/** Serialise a tax report to CSV. Pure, so the bytes are testable. */
export function taxReportToCsv(report: TaxReport): string {
  const header = ['asset', 'realized_pnl', 'fees'];
  const rows = report.lots.map((lot) =>
    [lot.asset, lot.realizedPnl.toFixed(8), lot.fees.toFixed(8)].map(csvField).join(','),
  );
  const footer = ['TOTAL', report.totalRealizedPnl.toFixed(8), report.totalFees.toFixed(8)].map(csvField).join(',');
  return [header.join(','), ...rows, footer].join('\n');
}
