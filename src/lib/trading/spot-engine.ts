/**
 * Spot settlement engine.
 *
 * The matching rules live in `./orderbook` and are pure; this module is the
 * durable half. It rebuilds the book from open orders, matches an incoming
 * order against it, and settles every fill by moving real balances: the buyer's
 * quote is consumed and base credited, the seller's base is consumed and quote
 * credited, and each side pays the fee its own VIP tier dictates.
 *
 * Everything runs inside one SQLite transaction, so a rejected order or a
 * failed settlement leaves no partial state. There is no in-memory book that
 * survives a request and no simulated liquidity: if no order has been placed,
 * the book is empty and an order that cannot fill is reported as such.
 */

import { getDb, generateId } from '@/lib/db';
import { parseUtcTimestamp } from '@/lib/trading/candles';
import {
  creditAvailable,
  lockAvailable,
  unlockAvailable,
  consumeLocked,
  availableBalance,
  covers,
  recordTransaction,
  LedgerError,
} from '@/lib/db/ledger';
import { resolveFeeTier, ratesFor, splitReferralCommission, type FeeTier } from '@/lib/trading/fees';
import { recordReferredTrade } from '@/lib/db/referral';
import { OrderBook, type Fill, type OrderRequest, type TimeInForce } from '@/lib/trading/orderbook';

export class SpotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export type SpotOrderType = 'limit' | 'market' | 'stop_limit' | 'stop_market';

export interface PlaceOrderInput {
  symbol: string;
  side: 'buy' | 'sell';
  type: SpotOrderType;
  price?: number;
  stopPrice?: number;
  quantity: number;
  timeInForce?: TimeInForce;
  postOnly?: boolean;
  icebergQuantity?: number;
  /** Set when a trading bot places the order, so the runner can track it. */
  botId?: string;
}

export interface OrderRecord {
  orderId: string;
  symbol: string;
  side: string;
  type: string;
  price: number | null;
  stopPrice: number | null;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  averagePrice: number | null;
  status: string;
  timeInForce: string;
  createdAt: string;
}

interface PairRow {
  pair_id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
  status: string;
  min_price: number | null;
  max_price: number | null;
  tick_size: number | null;
  min_quantity: number | null;
  max_quantity: number | null;
  min_notional: number | null;
  maker_fee: number | null;
  taker_fee: number | null;
}

interface OpenOrderRow {
  order_id: string;
  user_id: string;
  side: string;
  type: string;
  price: number | null;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  hidden_quantity: number | null;
  locked_amount: number | null;
  locked_asset: string | null;
  created_at: string;
}

function requireFinite(value: unknown, code: string, message: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new SpotError(code, message);
  return n;
}

/** Refuse a request while the venue is paused. */
export function assertSpotOpen(): void {
  const db = getDb();
  const rows = db
    .prepare("SELECT scope, paused, reason FROM exchange_controls WHERE scope IN ('spot', 'exchange')")
    .all() as Array<{ scope: string; paused: number; reason: string | null }>;

  const paused = rows.find((row) => row.paused === 1);
  if (paused) {
    throw new SpotError(
      'TRADING_PAUSED',
      `${paused.scope} trading is paused${paused.reason ? `: ${paused.reason}` : ''}`,
      409,
    );
  }
}

function getPair(symbol: string): PairRow {
  const pair = getDb()
    .prepare('SELECT * FROM trading_pairs WHERE symbol = ?')
    .get(symbol) as PairRow | undefined;
  if (!pair) throw new SpotError('UNKNOWN_SYMBOL', `${symbol} is not listed for spot trading`, 404);
  if (pair.status !== 'active') {
    throw new SpotError('MARKET_INACTIVE', `${symbol} is ${pair.status}`, 409);
  }
  return pair;
}

/** The fee schedule, ordered by level. */
function feeTiers(): FeeTier[] {
  const rows = getDb()
    .prepare('SELECT * FROM fee_schedule ORDER BY level')
    .all() as Array<{
    level: number;
    name: string;
    spot_maker_bps: number;
    spot_taker_bps: number;
    futures_maker_bps: number;
    futures_taker_bps: number;
    volume_threshold: number;
    tgr_holding_threshold: number;
  }>;

  return rows.map((row) => ({
    level: row.level,
    name: row.name,
    spotMaker: row.spot_maker_bps / 10000,
    spotTaker: row.spot_taker_bps / 10000,
    futuresMaker: row.futures_maker_bps / 10000,
    futuresTaker: row.futures_taker_bps / 10000,
    volumeThreshold: row.volume_threshold,
    holdingThreshold: row.tgr_holding_threshold,
  }));
}

/** 30-day traded notional for a user, from settled trades only. */
export function volume30d(userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(quote_quantity), 0) AS volume
         FROM spot_trades
        WHERE (maker_user_id = ? OR taker_user_id = ?)
          AND created_at >= datetime('now', '-30 day')`,
    )
    .get(userId, userId) as { volume: number } | undefined;
  return Number(row?.volume) || 0;
}

/** Resolve a user's spot maker and taker rates from the fee schedule. */
export function spotRates(userId: string): { maker: number; taker: number; level: number } {
  const tiers = feeTiers();
  if (tiers.length === 0) throw new SpotError('FEE_SCHEDULE_MISSING', 'No fee schedule is configured', 500);

  const resolved = resolveFeeTier(tiers, {
    volume30d: volume30d(userId),
    holding: availableBalance(userId, 'TGR'),
    payInNative: false,
  });

  const rates = ratesFor(resolved, 'spot');
  return { maker: rates.maker, taker: rates.taker, level: resolved.level };
}

/** Resolve a user's futures maker and taker rates from the same schedule. */
export function futuresRates(userId: string): { maker: number; taker: number; level: number } {
  const tiers = feeTiers();
  if (tiers.length === 0) throw new SpotError('FEE_SCHEDULE_MISSING', 'No fee schedule is configured', 500);

  const resolved = resolveFeeTier(tiers, {
    volume30d: volume30d(userId),
    holding: availableBalance(userId, 'TGR'),
    payInNative: false,
  });

  const rates = ratesFor(resolved, 'futures');
  return { maker: rates.maker, taker: rates.taker, level: resolved.level };
}

/** Rebuild the in-memory book for a symbol from its open orders. */
function loadBook(symbol: string): OrderBook {
  const book = new OrderBook(symbol);
  const rows = getDb()
    .prepare(
      `SELECT order_id, user_id, side, type, price, quantity, filled_quantity, remaining_quantity,
              hidden_quantity, locked_amount, locked_asset, created_at
         FROM orders
        WHERE pair_id = (SELECT pair_id FROM trading_pairs WHERE symbol = ?)
          AND status IN ('open', 'partial')
        ORDER BY created_at ASC`,
    )
    .all(symbol) as OpenOrderRow[];

  for (const row of rows) {
    if (row.price === null || row.remaining_quantity <= 0) continue;
    book.rest({
      orderId: row.order_id,
      userId: row.user_id,
      side: row.side === 'buy' ? 'buy' : 'sell',
      price: Number(row.price),
      quantity: Number(row.quantity),
      remaining: Number(row.remaining_quantity),
      hidden: Number(row.hidden_quantity) || 0,
    });
  }
  return book;
}

/** Quote notional needed to fill `quantity` against the visible book. */
function walkNotional(book: OrderBook, side: 'buy' | 'sell', quantity: number): { notional: number; fillable: number } {
  const levels = book.depth(side === 'buy' ? 'sell' : 'buy', 200);
  let remaining = quantity;
  let notional = 0;
  let fillable = 0;
  for (const level of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, level.quantity);
    notional += take * level.price;
    fillable += take;
    remaining -= take;
  }
  return { notional, fillable };
}

/** Last observed price for a symbol, or null when none has been recorded. */
function lastPrice(symbol: string): number | null {
  const db = getDb();
  const row = db.prepare('SELECT price FROM market_data WHERE symbol = ?').get(symbol) as
    | { price: number }
    | undefined;
  const price = Number(row?.price);
  if (Number.isFinite(price) && price > 0) return price;

  // The venue's own most recent settled trade is an observed price too, so a
  // symbol that trades here before an external feed publishes it can still
  // price a stop order's reservation rather than being refused outright.
  const trade = db
    .prepare('SELECT price FROM spot_trades WHERE symbol = ? ORDER BY created_at DESC LIMIT 1')
    .get(symbol) as { price: number } | undefined;
  const traded = Number(trade?.price);
  return Number.isFinite(traded) && traded > 0 ? traded : null;
}

function validateQuantity(pair: PairRow, quantity: number): void {
  if (pair.min_quantity !== null && quantity < Number(pair.min_quantity)) {
    throw new SpotError('QUANTITY_TOO_SMALL', `Quantity must be at least ${pair.min_quantity}`, 400);
  }
  if (pair.max_quantity !== null && quantity > Number(pair.max_quantity)) {
    throw new SpotError('QUANTITY_TOO_LARGE', `Quantity must be at most ${pair.max_quantity}`, 400);
  }
}

function validatePrice(pair: PairRow, price: number): void {
  if (pair.min_price !== null && price < Number(pair.min_price)) {
    throw new SpotError('PRICE_TOO_LOW', `Price must be at least ${pair.min_price}`, 400);
  }
  if (pair.max_price !== null && price > Number(pair.max_price)) {
    throw new SpotError('PRICE_TOO_HIGH', `Price must be at most ${pair.max_price}`, 400);
  }
  const tick = Number(pair.tick_size);
  if (Number.isFinite(tick) && tick > 0) {
    const steps = price / tick;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
      throw new SpotError('INVALID_TICK', `Price must be a multiple of the tick size ${tick}`, 400);
    }
  }
}

/**
 * Place a spot order.
 *
 * Funds are reserved before matching so an order can never fill without the
 * balance to settle it. A stop order is parked until a trade crosses its
 * trigger; a limit order rests on the book with the unfilled remainder.
 */
export function placeSpotOrder(userId: string, input: PlaceOrderInput): OrderRecord {
  assertSpotOpen();

  const symbol = String(input.symbol ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(symbol)) {
    throw new SpotError('VALIDATION_FAILED', 'symbol must be of the form BASE/QUOTE');
  }

  const side = input.side === 'sell' ? 'sell' : input.side === 'buy' ? 'buy' : null;
  if (side === null) throw new SpotError('VALIDATION_FAILED', 'side must be buy or sell');

  const type = input.type;
  if (!['limit', 'market', 'stop_limit', 'stop_market'].includes(type)) {
    throw new SpotError('VALIDATION_FAILED', 'type must be limit, market, stop_limit or stop_market');
  }

  const quantity = requireFinite(input.quantity, 'VALIDATION_FAILED', 'quantity must be a number');
  if (quantity <= 0) throw new SpotError('VALIDATION_FAILED', 'quantity must be positive');

  const pair = getPair(symbol);
  validateQuantity(pair, quantity);

  const isMarket = type === 'market' || type === 'stop_market';
  const isStop = type === 'stop_limit' || type === 'stop_market';

  let price: number | null = null;
  if (!isMarket) {
    price = requireFinite(input.price, 'VALIDATION_FAILED', 'a limit order requires a price');
    if (price <= 0) throw new SpotError('VALIDATION_FAILED', 'price must be positive');
    validatePrice(pair, price);
  }

  let stopPrice: number | null = null;
  if (isStop) {
    stopPrice = requireFinite(input.stopPrice, 'VALIDATION_FAILED', 'a stop order requires a stopPrice');
    if (stopPrice <= 0) throw new SpotError('VALIDATION_FAILED', 'stopPrice must be positive');
    validatePrice(pair, stopPrice);
  }

  const tif: TimeInForce = input.postOnly ? 'GTX' : input.timeInForce ?? 'GTC';
  if (!['GTC', 'IOC', 'FOK', 'GTX'].includes(tif)) {
    throw new SpotError('VALIDATION_FAILED', 'timeInForce must be GTC, IOC, FOK or GTX');
  }

  let icebergQuantity: number | undefined;
  if (input.icebergQuantity !== undefined) {
    const parsed = requireFinite(input.icebergQuantity, 'VALIDATION_FAILED', 'icebergQuantity must be a number');
    if (parsed <= 0 || parsed >= quantity) {
      throw new SpotError('VALIDATION_FAILED', 'icebergQuantity must be positive and below the order quantity');
    }
    icebergQuantity = parsed;
  }

  const db = getDb();
  const base = pair.base_currency;
  const quote = pair.quote_currency;
  const rates = spotRates(userId);

  let record: OrderRecord;
  // The price of the last fill this order produced, captured so parked stop
  // orders are triggered once the transaction has committed rather than from
  // inside it (a trigger places its own orders and must not nest).
  let lastFillPrice: number | null = null;

  const run = db.transaction(() => {
    const book = loadBook(symbol);

    // Reserve funds. A buy reserves quote, a sell reserves base.
    let lockedAmount: number;
    let lockedAsset: string;

    if (side === 'buy') {
      let notional: number;
      if (isMarket && !isStop) {
        const walk = walkNotional(book, side, quantity);
        if (walk.fillable <= 0) {
          throw new SpotError('NO_LIQUIDITY', `${symbol} has no offers to fill this market order`, 409);
        }
        notional = walk.notional;
      } else if (isStop && isMarket) {
        const reference = lastPrice(symbol);
        if (reference === null) {
          throw new SpotError('NO_PRICE', `${symbol} has no observed price to reserve funds against`, 409);
        }
        // A stop-market buy reserves against the trigger price plus a slippage
        // buffer, because the fill price is unknown until the stop triggers.
        notional = stopPrice! * quantity * 1.05;
        void reference;
      } else {
        notional = price! * quantity;
      }
      // The fee is charged in the received asset, so the reserved quote only
      // needs to cover the notional.
      lockedAmount = notional;
      lockedAsset = quote;
    } else {
      lockedAmount = quantity;
      lockedAsset = base;
    }

    const minNotional = Number(pair.min_notional);
    if (side === 'buy' && Number.isFinite(minNotional) && minNotional > 0) {
      const reference = price ?? stopPrice ?? lastPrice(symbol);
      if (reference !== null && reference * quantity < minNotional) {
        throw new SpotError('NOTIONAL_TOO_SMALL', `Order notional must be at least ${minNotional} ${quote}`, 400);
      }
    }

    lockAvailable(userId, lockedAsset, lockedAmount);

    const orderId = generateId();
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO orders
         (order_id, user_id, pair_id, side, type, price, quantity, filled_quantity, remaining_quantity,
          status, time_in_force, stop_price, iceberg_quantity, hidden_quantity, locked_amount, locked_asset, bot_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      orderId,
      userId,
      pair.pair_id,
      side,
      type,
      price,
      quantity,
      quantity,
      isStop ? 'pending_trigger' : 'open',
      tif,
      stopPrice,
      icebergQuantity ?? null,
      lockedAmount,
      lockedAsset,
      input.botId ?? null,
      createdAt,
    );

    if (isStop) {
      record = {
        orderId,
        symbol,
        side,
        type,
        price,
        stopPrice,
        quantity,
        filledQuantity: 0,
        remainingQuantity: quantity,
        averagePrice: null,
        status: 'pending_trigger',
        timeInForce: tif,
        createdAt,
      };
      return;
    }

    const outcome = matchAndSettle({
      orderId,
      userId,
      symbol,
      base,
      quote,
      side,
      type,
      price,
      quantity,
      tif,
      postOnly: input.postOnly === true,
      icebergQuantity,
      book,
      lockedAsset,
      lockedAmount,
      takerRate: rates.taker,
    });

    const filled = outcome.filled;
    const resting = outcome.resting;
    if (outcome.filled > 0 && outcome.averagePrice !== null) lastFillPrice = outcome.averagePrice;
    const status = outcome.rejected
      ? 'rejected'
      : resting > 0
        ? filled > 0
          ? 'partial'
          : 'open'
        : filled >= quantity
          ? 'filled'
          : filled > 0
            ? 'partial'
            : 'cancelled';

    db.prepare(
      `UPDATE orders
          SET filled_quantity = ?, remaining_quantity = ?, average_price = ?, status = ?,
              hidden_quantity = ?, updated_at = datetime('now')
        WHERE order_id = ?`,
    ).run(filled, resting, outcome.averagePrice, status, outcome.hidden, orderId);

    if (resting <= 0) {
      db.prepare('UPDATE orders SET locked_amount = 0 WHERE order_id = ?').run(orderId);
    }

    db.prepare(
      `INSERT INTO order_history
         (history_id, order_id, user_id, pair_id, side, type, price, quantity, filled_quantity,
          average_price, fee, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateId(),
      orderId,
      userId,
      pair.pair_id,
      side,
      type,
      price,
      quantity,
      filled,
      outcome.averagePrice,
      outcome.takerFeePaid,
      status,
    );

    record = {
      orderId,
      symbol,
      side,
      type,
      price,
      stopPrice,
      quantity,
      filledQuantity: filled,
      remainingQuantity: resting,
      averagePrice: outcome.averagePrice,
      status,
      timeInForce: tif,
      createdAt,
    };
  });

  try {
    run();
  } catch (error) {
    // A ledger rejection (insufficient balance) is a client error about this
    // order, so it is surfaced as a spot error rather than a 500.
    if (error instanceof LedgerError) throw new SpotError(error.code, error.message, error.status);
    throw error;
  }

  // A fill can cross the trigger of stop orders parked on this symbol. They are
  // activated now, after the transaction has committed, so each triggered order
  // reserves and matches on a consistent view of the book.
  if (lastFillPrice !== null) activateStopOrders(symbol, lastFillPrice);

  return record!;
}

interface MatchContext {
  orderId: string;
  userId: string;
  symbol: string;
  base: string;
  quote: string;
  side: 'buy' | 'sell';
  type: SpotOrderType;
  price: number | null;
  quantity: number;
  tif: TimeInForce;
  postOnly: boolean;
  icebergQuantity?: number;
  book: OrderBook;
  lockedAsset: string;
  lockedAmount: number;
  takerRate: number;
}

interface MatchOutcome {
  filled: number;
  resting: number;
  hidden: number;
  averagePrice: number | null;
  takerFeePaid: number;
  rejected: string | null;
}

/**
 * Match an order against the book and settle every fill.
 *
 * The taker's reservation was made at its own limit price, so a fill at a
 * better price releases the difference back to available rather than leaving it
 * locked. Maker orders release the same difference when they fill inside their
 * own limit.
 */
function matchAndSettle(ctx: MatchContext): MatchOutcome {
  const request: OrderRequest = {
    orderId: ctx.orderId,
    userId: ctx.userId,
    side: ctx.side,
    type: ctx.type === 'limit' || ctx.type === 'stop_limit' ? 'limit' : 'market',
    price: ctx.price ?? undefined,
    quantity: ctx.quantity,
    timeInForce: ctx.tif,
    postOnly: ctx.postOnly,
    icebergQuantity: ctx.icebergQuantity,
  };

  const result = ctx.book.match(request);

  let filled = 0;
  let notional = 0;
  let takerFeePaid = 0;

  for (const fill of result.fills) {
    const fee = settleFill(ctx, fill);
    filled += fill.quantity;
    notional += fill.price * fill.quantity;
    takerFeePaid += fee.takerFee;
  }

  // Reconcile the reservation with what is left open. Whatever was reserved for
  // quantity that neither filled nor rested is returned to available, and a
  // buy that printed inside its own limit returns the difference.
  const resting = result.resting;
  const wantedLocked =
    ctx.side === 'buy' ? (ctx.price !== null ? ctx.price * resting : 0) : resting;
  const consumed = ctx.side === 'buy' ? notional : filled;
  const leftover = ctx.lockedAmount - consumed - wantedLocked;
  if (leftover > 1e-9) {
    unlockAvailable(ctx.userId, ctx.lockedAsset, leftover);
  }

  if (filled > 0 && notional > 0) {
    recordReferredTrade(ctx.userId, notional, takerFeePaid);
  }

  return {
    filled,
    resting,
    hidden: ctx.icebergQuantity !== undefined ? Math.max(0, resting - ctx.icebergQuantity) : 0,
    averagePrice: filled > 0 ? notional / filled : null,
    takerFeePaid,
    rejected: result.rejected ?? null,
  };
}

/**
 * Settle one fill between a taker and a maker.
 *
 * Each side is debited the asset it gives and credited the asset it receives,
 * less its own fee, which is charged in the asset it receives. A taker-buyer
 * reserved quote at its limit price; when the fill prints better, the
 * difference is released back to available. A maker-seller's base and a
 * maker-buyer's quote were reserved when the order was placed, and the maker's
 * own reservation is released at its own limit price.
 */
function settleFill(ctx: MatchContext, fill: Fill): { makerFee: number; takerFee: number } {
  const db = getDb();
  const takerIsBuyer = ctx.side === 'buy';

  const makerOrder = db
    .prepare('SELECT user_id, side, price FROM orders WHERE order_id = ?')
    .get(fill.makerOrderId) as { user_id: string; side: string; price: number } | undefined;

  if (!makerOrder) {
    throw new SpotError('BOOK_INCONSISTENT', 'A resting order disappeared before settlement', 500);
  }

  const makerUserId = makerOrder.user_id;
  const makerSide: 'buy' | 'sell' = makerOrder.side === 'buy' ? 'buy' : 'sell';
  const makerPrice = Number(makerOrder.price);

  const buyerId = takerIsBuyer ? ctx.userId : makerUserId;
  const sellerId = takerIsBuyer ? makerUserId : ctx.userId;
  const buyerRate = takerIsBuyer ? ctx.takerRate : spotRates(makerUserId).maker;
  const sellerRate = takerIsBuyer ? spotRates(makerUserId).maker : ctx.takerRate;

  const grossQuote = fill.price * fill.quantity;
  const buyerFeeBase = fill.quantity * buyerRate;
  const sellerFeeQuote = grossQuote * sellerRate;

  // Buyer gives quote and receives base less its fee.
  if (takerIsBuyer) {
    // The taker reserved quote at its own limit; release any improvement.
    const reserved = ctx.price !== null ? ctx.price * fill.quantity : grossQuote;
    if (reserved > grossQuote) unlockAvailable(ctx.userId, ctx.quote, reserved - grossQuote);
    consumeLocked(ctx.userId, ctx.quote, grossQuote);
  } else {
    const reserved = makerPrice * fill.quantity;
    if (reserved > grossQuote) unlockAvailable(makerUserId, ctx.quote, reserved - grossQuote);
    consumeLocked(makerUserId, ctx.quote, grossQuote);
  }
  creditAvailable(buyerId, ctx.base, fill.quantity - buyerFeeBase);

  // Seller gives base and receives quote less its fee.
  if (takerIsBuyer) {
    consumeLocked(makerUserId, ctx.base, fill.quantity);
  } else {
    consumeLocked(ctx.userId, ctx.base, fill.quantity);
  }
  creditAvailable(sellerId, ctx.quote, grossQuote - sellerFeeQuote);

  const remaining = db
    .prepare('SELECT remaining_quantity FROM orders WHERE order_id = ?')
    .get(fill.makerOrderId) as { remaining_quantity: number };
  const makerLockedReduction = makerSide === 'buy' ? makerPrice * fill.quantity : fill.quantity;
  const nextRemaining = Math.max(0, Number(remaining.remaining_quantity) - fill.quantity);

  db.prepare(
    `UPDATE orders
        SET filled_quantity = filled_quantity + ?,
            remaining_quantity = ?,
            locked_amount = MAX(0, COALESCE(locked_amount, 0) - ?),
            status = ?,
            updated_at = datetime('now')
      WHERE order_id = ?`,
  ).run(
    fill.quantity,
    nextRemaining,
    makerLockedReduction,
    nextRemaining <= 0 ? 'filled' : 'partial',
    fill.makerOrderId,
  );

  db.prepare(
    `INSERT INTO spot_trades
       (trade_id, symbol, maker_order_id, taker_order_id, maker_user_id, taker_user_id, side,
        price, quantity, quote_quantity, maker_fee, taker_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    ctx.symbol,
    fill.makerOrderId,
    fill.takerOrderId,
    makerUserId,
    ctx.userId,
    ctx.side,
    fill.price,
    fill.quantity,
    grossQuote,
    takerIsBuyer ? sellerFeeQuote : buyerFeeBase,
    takerIsBuyer ? buyerFeeBase : sellerFeeQuote,
  );

  recordTransaction(
    ctx.userId,
    'trade',
    takerIsBuyer ? ctx.base : ctx.quote,
    takerIsBuyer ? fill.quantity : grossQuote,
    takerIsBuyer ? buyerFeeBase : sellerFeeQuote,
    'completed',
    `${takerIsBuyer ? 'Buy' : 'Sell'} ${fill.quantity} ${ctx.base} at ${fill.price} ${ctx.quote}`,
  );

  const takerFee = takerIsBuyer ? buyerFeeBase : sellerFeeQuote;
  const makerFee = takerIsBuyer ? sellerFeeQuote : buyerFeeBase;

  recordRevenue(ctx.symbol, takerIsBuyer ? ctx.base : ctx.quote, takerFee, ctx.userId);
  recordRevenue(ctx.symbol, takerIsBuyer ? ctx.quote : ctx.base, makerFee, makerUserId);

  return { makerFee, takerFee };
}

function recordRevenue(symbol: string, asset: string, fee: number, userId: string): void {
  if (!Number.isFinite(fee) || fee <= 0) return;
  const commissionRate = referrerCommissionRate(userId);
  const { exchangeShare } = splitReferralCommission(fee, commissionRate);
  if (exchangeShare <= 0) return;
  getDb()
    .prepare(
      `INSERT INTO revenue_ledger (entry_id, category, asset, amount, user_id, reference)
       VALUES (?, 'spot_fee', ?, ?, ?, ?)`,
    )
    .run(generateId(), asset, exchangeShare, userId, symbol);
}

/** Referral commission rate a referrer earns on a referee's fee. */
function referrerCommissionRate(userId: string): number {
  const row = getDb().prepare('SELECT status FROM referrals WHERE referee_id = ?').get(userId) as
    | { status: string }
    | undefined;
  return row?.status === 'active' ? 0.4 : 0;
}

/** Open orders for a user, optionally filtered to one symbol. */
export function listOpenOrders(userId: string, symbol: string | null): OrderRecord[] {
  const db = getDb();
  const params: string[] = [userId];
  let where = "o.user_id = ? AND o.status IN ('open', 'partial', 'pending_trigger')";
  if (symbol) {
    where += ' AND p.symbol = ?';
    params.push(symbol);
  }

  const rows = db
    .prepare(
      `SELECT o.*, p.symbol FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE ${where} ORDER BY o.created_at DESC LIMIT 500`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map(toOrderRecord);
}

/** Order history for a user, optionally filtered to one symbol. */
export function listOrderHistory(userId: string, symbol: string | null, limit: number): OrderRecord[] {
  const db = getDb();
  const params: Array<string | number> = [userId];
  let where = 'o.user_id = ?';
  if (symbol) {
    where += ' AND p.symbol = ?';
    params.push(symbol);
  }
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT o.*, p.symbol FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE ${where} ORDER BY o.created_at DESC LIMIT ?`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map(toOrderRecord);
}

/** One order belonging to a user. */
export function getOrder(userId: string, orderId: string): OrderRecord | null {
  const row = getDb()
    .prepare(
      `SELECT o.*, p.symbol FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE o.order_id = ? AND o.user_id = ?`,
    )
    .get(orderId, userId) as Record<string, unknown> | undefined;
  return row ? toOrderRecord(row) : null;
}

function toOrderRecord(row: Record<string, unknown>): OrderRecord {
  return {
    orderId: String(row.order_id),
    symbol: String(row.symbol),
    side: String(row.side),
    type: String(row.type),
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    stopPrice: row.stop_price === null || row.stop_price === undefined ? null : Number(row.stop_price),
    quantity: Number(row.quantity),
    filledQuantity: Number(row.filled_quantity) || 0,
    remainingQuantity: Number(row.remaining_quantity) || 0,
    averagePrice: row.average_price === null || row.average_price === undefined ? null : Number(row.average_price),
    status: String(row.status),
    timeInForce: String(row.time_in_force ?? 'GTC'),
    createdAt: String(row.created_at),
  };
}

/**
 * Cancel a resting order and release whatever it still has reserved.
 *
 * The reserved amount is derived from the order's own row, so a partially
 * filled order releases only the remainder.
 */
export function cancelSpotOrder(userId: string, orderId: string): OrderRecord {
  const db = getDb();
  let cancelled: OrderRecord | null = null;

  const run = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT o.*, p.symbol, p.base_currency, p.quote_currency
           FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
          WHERE o.order_id = ? AND o.user_id = ?`,
      )
      .get(orderId, userId) as (Record<string, unknown> & { base_currency: string; quote_currency: string }) | undefined;

    if (!row) throw new SpotError('UNKNOWN_ORDER', 'No such order', 404);
    const status = String(row.status);
    if (status === 'filled' || status === 'cancelled' || status === 'rejected') {
      throw new SpotError('TERMINAL_ORDER', `This order is already ${status}`, 409);
    }

    const side = String(row.side);
    const remaining = Number(row.remaining_quantity) || 0;
    const hidden = Number(row.hidden_quantity) || 0;
    const lockedAmount = Number(row.locked_amount) || 0;
    const price = row.price === null || row.price === undefined ? null : Number(row.price);

    let release = 0;
    if (lockedAmount > 0) {
      if (side === 'buy') {
        release = price !== null ? price * (remaining + hidden) : lockedAmount;
      } else {
        release = remaining + hidden;
      }
      if (release > lockedAmount) release = lockedAmount;
      if (release > 0) {
        unlockAvailable(userId, side === 'buy' ? row.quote_currency : row.base_currency, release);
      }
    }

    db.prepare(
      `UPDATE orders SET status = 'cancelled', remaining_quantity = 0, hidden_quantity = 0,
              locked_amount = MAX(0, COALESCE(locked_amount, 0) - ?), updated_at = datetime('now')
        WHERE order_id = ?`,
    ).run(release, orderId);

    db.prepare(
      `INSERT INTO order_history
         (history_id, order_id, user_id, pair_id, side, type, price, quantity, filled_quantity,
          average_price, fee, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'cancelled')`,
    ).run(
      generateId(),
      orderId,
      userId,
      row.pair_id,
      side,
      row.type,
      price,
      Number(row.quantity),
      Number(row.filled_quantity) || 0,
      row.average_price === null || row.average_price === undefined ? null : Number(row.average_price),
    );

    cancelled = { ...toOrderRecord({ ...row, status: 'cancelled', remaining_quantity: 0 }) };
  });

  try {
    run();
  } catch (error) {
    if (error instanceof LedgerError) throw new SpotError(error.code, error.message, error.status);
    throw error;
  }
  return cancelled!;
}

/** Settled trades for a user, newest first. */
export function listTrades(userId: string, symbol: string | null, limit: number): Array<{
  tradeId: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  total: number;
  fee: number;
  timestamp: number;
  role: string;
}> {
  const db = getDb();
  const params: Array<string | number> = [userId, userId];
  let where = '(maker_user_id = ? OR taker_user_id = ?)';
  if (symbol) {
    where += ' AND symbol = ?';
    params.push(symbol);
  }
  params.push(limit);

  const rows = db
    .prepare(`SELECT * FROM spot_trades WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const isMaker = row.maker_user_id === userId;
    // `side` on the trade row is the taker's side; the maker took the other one.
    const takerSide = String(row.side);
    const userSide = isMaker ? (takerSide === 'buy' ? 'sell' : 'buy') : takerSide;
    return {
      tradeId: String(row.trade_id),
      symbol: String(row.symbol),
      side: userSide,
      price: Number(row.price),
      quantity: Number(row.quantity),
      total: Number(row.quote_quantity),
      fee: Number(isMaker ? row.maker_fee : row.taker_fee),
      timestamp: parseUtcTimestamp(String(row.created_at)),
      role: isMaker ? 'maker' : 'taker',
    };
  });
}

/**
 * Activate stop orders whose trigger has been crossed by a trade.
 *
 * A buy stop triggers when the traded price reaches or exceeds the stop; a sell
 * stop triggers at or below it. An activated order is placed as a market order
 * using the same reservation it already holds.
 */
export function activateStopOrders(symbol: string, tradedPrice: number): number {
  if (!Number.isFinite(tradedPrice) || tradedPrice <= 0) return 0;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT o.order_id, o.user_id, o.side, o.type, o.price, o.quantity, o.stop_price, o.time_in_force
         FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE p.symbol = ? AND o.status = 'pending_trigger'`,
    )
    .all(symbol) as Array<{
    order_id: string;
    user_id: string;
    side: string;
    type: string;
    price: number | null;
    quantity: number;
    stop_price: number;
    time_in_force: string;
  }>;

  let activated = 0;
  for (const row of rows) {
    const triggers =
      row.side === 'buy' ? tradedPrice >= Number(row.stop_price) : tradedPrice <= Number(row.stop_price);
    if (!triggers) continue;

    // Mark it live before matching so a re-entrant trigger check cannot see it twice.
    db.prepare("UPDATE orders SET status = 'open', updated_at = datetime('now') WHERE order_id = ?").run(row.order_id);

    try {
      matchRestingOrder(row.order_id, row.user_id, symbol, row.side === 'buy' ? 'buy' : 'sell', row.type);
      activated += 1;
    } catch {
      // A stop that cannot be filled stays cancelled rather than retrying forever.
      db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE order_id = ?").run(row.order_id);
    }
  }
  return activated;
}

/** Match an order that was already reserved (a triggered stop). */
function matchRestingOrder(
  orderId: string,
  userId: string,
  symbol: string,
  side: 'buy' | 'sell',
  type: string,
): void {
  const db = getDb();
  const pair = getPair(symbol);
  const book = loadBook(symbol);
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId) as
    | { price: number | null; quantity: number; time_in_force: string; locked_amount: number; locked_asset: string }
    | undefined;
  if (!order) return;

  const rates = spotRates(userId);
  const quantity = Number(order.quantity);

  const outcome = matchAndSettle({
    orderId,
    userId,
    symbol,
    base: pair.base_currency,
    quote: pair.quote_currency,
    side,
    type: type === 'stop_limit' ? 'stop_limit' : 'stop_market',
    price: order.price === null ? null : Number(order.price),
    quantity,
    tif: (order.time_in_force as TimeInForce) ?? 'GTC',
    postOnly: false,
    book,
    lockedAsset: order.locked_asset,
    lockedAmount: Number(order.locked_amount),
    takerRate: rates.taker,
  });

  const status =
    outcome.filled >= quantity ? 'filled' : outcome.filled > 0 ? 'partial' : 'cancelled';

  db.prepare(
    `UPDATE orders SET filled_quantity = ?, remaining_quantity = ?, average_price = ?, status = ?,
            updated_at = datetime('now') WHERE order_id = ?`,
  ).run(outcome.filled, Math.max(0, quantity - outcome.filled), outcome.averagePrice, status, orderId);

  if (outcome.filled > 0 && outcome.averagePrice !== null) {
    activateStopOrders(symbol, outcome.averagePrice);
  }
}
