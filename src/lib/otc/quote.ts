/**
 * OTC block quotes.
 *
 * A block quote is priced by walking the venue's own order book for the
 * requested size, so the quote reflects the depth that actually exists and the
 * slippage a large order would incur. When the book cannot fill the size the
 * quote is still returned with the shortfall flagged; when there is no price at
 * all the request is refused rather than quoted from a guess.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { orderBookDepth, lastTradePrice, type DepthLevel } from '@/lib/trading/market-view';

export class OtcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** The spread the desk charges over the touched book, as a fraction. */
export const OTC_SPREAD = 0.002;
/** A quote is valid for this long before it must be re-requested. */
export const OTC_QUOTE_TTL_MS = 30_000;

export interface OtcQuote {
  id: string;
  quote_id: string;
  asset: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  quotePrice: number;
  quote_price: number;
  filledAmount: number;
  unfilledAmount: number;
  fee: number;
  feeAsset: string;
  status: string;
  expiresAt: string;
  expires_at: string;
  createdAt: string;
  created_at: string;
}

function toView(row: Record<string, unknown>): OtcQuote {
  return {
    id: String(row.quote_id),
    quote_id: String(row.quote_id),
    asset: String(row.symbol).split('/')[0],
    symbol: String(row.symbol),
    side: String(row.side) === 'sell' ? 'sell' : 'buy',
    amount: Number(row.amount),
    quotePrice: Number(row.quote_price),
    quote_price: Number(row.quote_price),
    filledAmount: Number(row.amount),
    unfilledAmount: 0,
    fee: Number(row.fee),
    feeAsset: String(row.symbol).split('/')[1] ?? 'RUSD',
    status: String(row.status),
    expiresAt: String(row.expires_at),
    expires_at: String(row.expires_at),
    createdAt: String(row.created_at),
    created_at: String(row.created_at),
  };
}

/**
 * Volume-weighted price to fill `quantity` from one side of the book.
 *
 * Returns the average price over the levels consumed and how much of the
 * requested size the book could absorb. An empty or one-sided book reports a
 * zero fill rather than a price.
 */
export function vwapFromLevels(levels: DepthLevel[], quantity: number): { price: number; filled: number } {
  if (!Number.isFinite(quantity) || quantity <= 0) return { price: 0, filled: 0 };
  let remaining = quantity;
  let cost = 0;
  let filled = 0;
  for (const level of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(level.quantity) || 0);
    if (take <= 0) continue;
    cost += take * Number(level.price);
    filled += take;
    remaining -= take;
  }
  return filled > 0 ? { price: cost / filled, filled } : { price: 0, filled: 0 };
}

/**
 * Request a block quote.
 *
 * The price is the book's volume-weighted price for the size, adjusted by the
 * desk spread in the direction that is unfavourable to the requester. When the
 * book cannot absorb the size the last traded price is used as a reference and
 * the shortfall is recorded, so the requester can see the book is thin.
 */
export function requestQuote(userId: string, asset: string, side: string, amount: number): OtcQuote {
  const base = String(asset ?? '').trim().toUpperCase();
  if (!base) throw new OtcError('VALIDATION_FAILED', 'An asset is required');
  if (side !== 'buy' && side !== 'sell') throw new OtcError('VALIDATION_FAILED', 'side must be buy or sell');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new OtcError('VALIDATION_FAILED', 'amount must be a positive number');
  }

  const db = getDb();
  const pair = db
    .prepare("SELECT symbol FROM trading_pairs WHERE base_currency = ? AND status = 'active' ORDER BY quote_currency LIMIT 1")
    .get(base) as { symbol: string } | undefined;
  if (!pair) throw new OtcError('UNKNOWN_ASSET', `${base} is not listed for OTC`, 404);
  const symbol = pair.symbol;

  const depth = orderBookDepth(symbol, 200);
  const levels = side === 'buy' ? depth.asks : depth.bids;
  const { price: bookPrice, filled } = vwapFromLevels(levels, amount);
  const reference = bookPrice > 0 ? bookPrice : lastTradePrice(symbol) ?? 0;
  if (!(reference > 0)) {
    throw new OtcError('NO_PRICE', `${symbol} has no market price; a quote cannot be produced`, 409);
  }

  // A buy pays the offer plus the spread; a sell receives the bid less it.
  const quotePrice = side === 'buy' ? reference * (1 + OTC_SPREAD) : reference * (1 - OTC_SPREAD);
  const fee = amount * quotePrice * OTC_SPREAD;
  const expiresAt = new Date(Date.now() + OTC_QUOTE_TTL_MS).toISOString();
  const quoteId = generateId();

  db.prepare(
    `INSERT INTO otc_quotes (quote_id, user_id, symbol, side, amount, quote_price, fee, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'quoted', ?)`,
  ).run(quoteId, userId, symbol, side, amount, quotePrice, fee, expiresAt);

  const row = db.prepare('SELECT * FROM otc_quotes WHERE quote_id = ?').get(quoteId) as Record<string, unknown>;
  const view = toView(row);
  view.filledAmount = filled;
  view.unfilledAmount = Math.max(0, amount - filled);
  return view;
}

/** The caller's own quote history, newest first. */
export function quoteHistory(userId: string, limit = 50): OtcQuote[] {
  const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50;
  const rows = getDb()
    .prepare('SELECT * FROM otc_quotes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, bounded) as Array<Record<string, unknown>>;
  return rows.map(toView);
}
