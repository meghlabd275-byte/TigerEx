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
import { parseUtcTimestamp } from '@/lib/trading/candles';
import { creditAvailable, debitAvailable, covers, availableBalance, recordTransaction } from '@/lib/db/ledger';
import { creditFund, debitFund, fundBalance, recordDexRevenue } from '@/lib/dex/pool-service';
import { recordPoolMove } from '@/lib/db/accounting';

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

/** The account the desk quotes from: the venue's own OTC inventory, per asset. */
export function otcDeskAccount(asset: string): string {
  return `dex_otc_desk:${asset.toUpperCase()}`;
}

/** Move inventory into the desk account so it can fill client blocks. */
export function fundOtcDesk(asset: string, amount: number): void {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new OtcError('VALIDATION_FAILED', 'amount must be a positive number');
  creditFund(otcDeskAccount(asset), asset.toUpperCase(), value);
}

/** The inventory the desk currently holds for an asset. */
export function otcDeskBalance(asset: string): number {
  return fundBalance(otcDeskAccount(asset), asset.toUpperCase());
}

export interface OtcFillResult {
  quoteId: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  baseAmount: number;
  quoteAmount: number;
  fee: number;
  feeAsset: string;
  status: string;
}

/**
 * Execute an OTC block quote against the desk's own inventory.
 *
 * A block trade is settled bilaterally with the venue's desk rather than by
 * crossing the public book, so a large order moves no book price and incurs no
 * market impact. Both legs are real ledger movements between the client and the
 * desk account, which an operator funds with `fundOtcDesk`; a desk that does not
 * hold the asset it would deliver fails closed, so a fill can never conjure
 * inventory. The spread the quote carried is the desk's revenue and is booked to
 * the treasury, so the two legs balance to the last unit.
 */
export function executeQuote(userId: string, quoteId: string): OtcFillResult {
  const db = getDb();
  const row = db.prepare('SELECT * FROM otc_quotes WHERE quote_id = ?').get(quoteId) as
    | { quote_id: string; user_id: string; symbol: string; side: string; amount: number; quote_price: number; fee: number; status: string; expires_at: string }
    | undefined;
  if (!row) throw new OtcError('QUOTE_NOT_FOUND', 'no quote with that id', 404);
  if (row.user_id !== userId) throw new OtcError('QUOTE_NOT_FOUND', 'no quote with that id', 404);
  if (row.status !== 'quoted') throw new OtcError('QUOTE_NOT_OPEN', `the quote is ${row.status}`, 409);
  if (parseUtcTimestamp(row.expires_at) < Date.now()) throw new OtcError('QUOTE_EXPIRED', 'the quote has expired', 409);

  const [base, quote] = row.symbol.split('/');
  const side = row.side === 'sell' ? 'sell' : 'buy';
  const amount = Number(row.amount);
  const price = Number(row.quote_price);
  const fee = Number(row.fee);
  const grossQuote = amount * price;

  // A buy delivers the base to the client and takes the quote; a sell is the
  // mirror. The desk is the counterparty on both legs.
  const clientPays = side === 'buy' ? grossQuote : amount;
  const clientPaysAsset = side === 'buy' ? quote : base;
  const clientReceives = side === 'buy' ? amount : grossQuote;
  const clientReceivesAsset = side === 'buy' ? base : quote;

  if (!covers(availableBalance(userId, clientPaysAsset), clientPays)) {
    throw new OtcError('INSUFFICIENT_BALANCE', `Insufficient ${clientPaysAsset} balance to settle the block`, 400);
  }
  if (!covers(otcDeskBalance(clientReceivesAsset), clientReceives)) {
    throw new OtcError('DESK_INVENTORY_LOW', `the OTC desk does not hold enough ${clientReceivesAsset}`, 409);
  }

  db.transaction(() => {
    debitAvailable(userId, clientPaysAsset, clientPays);
    recordPoolMove(userId, clientPaysAsset, -clientPays, 'otc_desk', `otc ${row.symbol}`);
    recordTransaction(userId, 'otc_block', clientPaysAsset, clientPays, 0, 'completed', `otc ${row.symbol}`);
    creditFund(otcDeskAccount(clientPaysAsset), clientPaysAsset, clientPays);

    debitFund(otcDeskAccount(clientReceivesAsset), clientReceivesAsset, clientReceives);
    creditAvailable(userId, clientReceivesAsset, clientReceives);
    recordPoolMove(userId, clientReceivesAsset, clientReceives, 'otc_desk', `otc ${row.symbol}`);
    recordTransaction(userId, 'otc_block', clientReceivesAsset, clientReceives, 0, 'completed', `otc ${row.symbol}`);

    // The quote's spread is the desk's revenue; book it to the treasury.
    if (fee > 0) {
      recordDexRevenue('dex_otc_fee', quote, fee, { lp: 0, vetgr: 0, treasury: fee, insurance: 0, burn: 0 }, row.quote_id);
    }
    db.prepare("UPDATE otc_quotes SET status = 'filled' WHERE quote_id = ?").run(row.quote_id);
  })();

  return {
    quoteId: row.quote_id,
    symbol: row.symbol,
    side,
    amount,
    price,
    baseAmount: amount,
    quoteAmount: grossQuote,
    fee,
    feeAsset: quote,
    status: 'filled',
  };
}
