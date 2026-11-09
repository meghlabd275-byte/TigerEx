import { getDb, generateId } from '@/lib/db';
import { availableBalance, debitAvailable, creditAvailable } from '@/lib/db/ledger';

export const CONVERT_FEE_RATE = 0.001; // 0.1% conversion fee

/**
 * Look up the current mid price for a conversion.
 *
 * Prices come from the `market_data` table, which is populated by the live
 * market-data service. There is no fallback rate: when no price exists the
 * conversion is reported as unavailable rather than executed at a made-up rate.
 */
export function conversionRate(fromAsset: string, toAsset: string): number | null {
  const db = getDb();
  const from = fromAsset.toUpperCase();
  const to = toAsset.toUpperCase();
  if (from === to) return 1;

  const priceOf = (base: string, quote: string): number | null => {
    const row = db
      .prepare(
        `SELECT price FROM market_data
          WHERE symbol IN (?, ?) AND price IS NOT NULL AND price > 0
          LIMIT 1`,
      )
      .get(`${base}${quote}`, `${base}/${quote}`) as { price: number } | undefined;
    return row?.price ?? null;
  };

  const direct = priceOf(from, to);
  if (direct) return direct;

  const inverse = priceOf(to, from);
  if (inverse && inverse > 0) return 1 / inverse;

  // Cross through a common quote asset when a direct pair is not listed.
  for (const bridge of ['USDT', 'USDC', 'RUSD']) {
    if (bridge === from || bridge === to) continue;
    const a = priceOf(from, bridge);
    const b = priceOf(to, bridge);
    if (a && b && b > 0) return a / b;
  }
  return null;
}

export interface ConvertQuote {
  fromAsset: string;
  toAsset: string;
  fromAmount: number;
  rate: number;
  fee: number;
  feeAsset: string;
  toAmount: number;
}

export function quoteConvert(fromAsset: string, toAsset: string, amount: number): ConvertQuote | null {
  const rate = conversionRate(fromAsset, toAsset);
  if (rate === null) return null;
  const fee = amount * CONVERT_FEE_RATE;
  const netFrom = amount - fee;
  return {
    fromAsset: fromAsset.toUpperCase(),
    toAsset: toAsset.toUpperCase(),
    fromAmount: amount,
    rate,
    fee,
    feeAsset: fromAsset.toUpperCase(),
    toAmount: netFrom * rate,
  };
}

export class ConvertError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Execute a conversion for the authenticated user.
 *
 * Debits the source asset, credits the destination asset at the quoted rate
 * and writes a transaction record. The whole operation runs in one SQLite
 * transaction so a failure cannot leave the two sides out of balance, and the
 * debit goes through the ledger, which spreads it across every balance row that
 * holds the asset rather than trusting a single row.
 */
export function executeConvert(userId: string, fromAsset: string, toAsset: string, amount: number): ConvertQuote {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ConvertError('INVALID_AMOUNT', 'Amount must be greater than zero');
  }
  const quote = quoteConvert(fromAsset, toAsset, amount);
  if (!quote) {
    throw new ConvertError('RATE_UNAVAILABLE', 'No market price is available for this pair', 409);
  }

  const db = getDb();
  const from = quote.fromAsset;
  const to = quote.toAsset;

  const run = db.transaction(() => {
    if (availableBalance(userId, from) + 1e-9 < amount) {
      throw new ConvertError('INSUFFICIENT_BALANCE', `Insufficient ${from} balance`, 400);
    }
    debitAvailable(userId, from, amount);
    creditAvailable(userId, to, quote.toAmount);
    db.prepare(
      `INSERT INTO transactions (transaction_id, user_id, type, currency, amount, fee, status, memo)
       VALUES (?, ?, 'convert', ?, ?, ?, 'completed', ?)`,
    ).run(
      generateId(),
      userId,
      to,
      quote.toAmount,
      quote.fee,
      `Convert ${amount} ${from} -> ${quote.toAmount} ${to}`,
    );
  });
  run();

  return quote;
}

export interface ConvertRecord {
  transactionId: string;
  amount: number;
  fee: number;
  currency: string;
  memo: string | null;
  status: string;
  createdAt: string;
}

export function listConvertHistory(userId: string, limit: number, offset: number): ConvertRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT transaction_id, amount, fee, currency, memo, status, created_at
         FROM transactions
        WHERE user_id = ? AND type = 'convert'
        ORDER BY created_at DESC, transaction_id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset) as Array<{
    transaction_id: string;
    amount: number;
    fee: number;
    currency: string;
    memo: string | null;
    status: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    transactionId: r.transaction_id,
    amount: r.amount,
    fee: r.fee,
    currency: r.currency,
    memo: r.memo,
    status: r.status,
    createdAt: r.created_at,
  }));
}
