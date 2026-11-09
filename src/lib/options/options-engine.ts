/**
 * Options trading engine.
 *
 * A contract is a row in `options_markets` created through the admin console; a
 * position is a user's holding in one contract. The premium is the pure
 * Black-Scholes price from `@/lib/options/pricing`, and settlement pays the
 * intrinsic value at expiry. Nothing here invents a price: an underlying with no
 * observable spot price cannot be traded, and a position is marked at the model
 * premium rather than at a stored quote.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { debitAvailable, creditAvailable, recordTransaction } from '@/lib/db/ledger';
import { usdPrice } from '@/lib/db/portfolio';
import { blackScholes, settlementValue, impliedVolatility, type OptionGreeks } from '@/lib/options/pricing';

export class OptionsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface OptionsMarket {
  marketId: string;
  symbol: string;
  underlying: string;
  settlementAsset: string;
  optionType: 'call' | 'put';
  strikePrice: number;
  expiryNs: number;
  exerciseStyle: string;
  contractSize: number;
  tickSize: number;
  minQuantity: number;
  maxQuantity: number;
  makerFeeBps: number;
  takerFeeBps: number;
  impliedVolatility: number | null;
  status: string;
}

function toMarket(row: Record<string, unknown>): OptionsMarket {
  return {
    marketId: String(row.market_id),
    symbol: String(row.symbol),
    underlying: String(row.underlying),
    settlementAsset: String(row.settlement_asset),
    optionType: row.option_type === 'put' ? 'put' : 'call',
    strikePrice: Number(row.strike_price) || 0,
    expiryNs: Number(row.expiry_ns) || 0,
    exerciseStyle: String(row.exercise_style ?? 'european'),
    contractSize: Number(row.contract_size) || 1,
    tickSize: Number(row.tick_size) || 0,
    minQuantity: Number(row.min_quantity) || 0,
    maxQuantity: Number(row.max_quantity) || 0,
    makerFeeBps: Number(row.maker_fee_bps) || 0,
    takerFeeBps: Number(row.taker_fee_bps) || 0,
    impliedVolatility: row.implied_volatility === null || row.implied_volatility === undefined
      ? null
      : Number(row.implied_volatility),
    status: String(row.status),
  };
}

/** Listed contracts, optionally filtered. */
export function listOptionsMarkets(filter: {
  underlying?: string;
  type?: string;
  settlement?: string;
  includeExpired?: boolean;
} = {}): OptionsMarket[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.underlying) {
    clauses.push('underlying = ?');
    params.push(filter.underlying.trim().toUpperCase());
  }
  if (filter.type) {
    clauses.push('option_type = ?');
    params.push(filter.type.trim().toLowerCase());
  }
  if (filter.settlement) {
    clauses.push('settlement_asset = ?');
    params.push(filter.settlement.trim().toUpperCase());
  }
  if (!filter.includeExpired) {
    clauses.push("status = 'active'");
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM options_markets${where} ORDER BY underlying, expiry_ns, strike_price LIMIT 2000`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(toMarket);
}

export function getOptionsMarket(symbol: string): OptionsMarket | null {
  const row = getDb()
    .prepare('SELECT * FROM options_markets WHERE symbol = ?')
    .get(symbol.trim().toUpperCase()) as Record<string, unknown> | undefined;
  return row ? toMarket(row) : null;
}

/** The venue's spot price for a contract's underlying, or null when unpriced. */
export function underlyingSpot(underlying: string): number | null {
  return usdPrice(underlying);
}

export interface ContractQuote {
  symbol: string;
  underlying: string;
  optionType: 'call' | 'put';
  strike: number;
  spot: number;
  timeToExpiryYears: number;
  volatility: number;
  riskFreeRate: number;
  greeks: OptionGreeks;
  mark: number;
  settlementAsset: string;
}

/** The risk-free rate used for pricing, configurable and defaulting to 0. */
function riskFreeRate(): number {
  const configured = Number(process.env.TIGEREX_OPTIONS_RISK_FREE_RATE);
  return Number.isFinite(configured) ? configured : 0;
}

/**
 * Price one contract.
 *
 * The volatility is the contract's listed implied volatility, falling back to
 * the configured default only when the listing carries none. A contract whose
 * underlying has no observable price cannot be quoted, and the caller receives
 * an explicit error rather than a fabricated premium.
 */
export function quoteContract(market: OptionsMarket, nowMs: number = Date.now()): ContractQuote {
  const spot = underlyingSpot(market.underlying);
  if (spot === null || spot <= 0) {
    throw new OptionsError('NO_UNDERLYING_PRICE', `No observable price for ${market.underlying}`, 503);
  }
  const timeToExpiryYears = Math.max(0, (market.expiryNs / 1e6 - nowMs) / (365 * 24 * 60 * 60 * 1000));
  const configuredVol = Number(process.env.TIGEREX_OPTIONS_DEFAULT_VOLATILITY);
  const volatility =
    market.impliedVolatility !== null && market.impliedVolatility > 0
      ? market.impliedVolatility
      : Number.isFinite(configuredVol) && configuredVol > 0
        ? configuredVol
        : 0.8;

  const priced = blackScholes({
    spot,
    strike: market.strikePrice,
    timeToExpiry: timeToExpiryYears,
    volatility,
    riskFreeRate: riskFreeRate(),
    type: market.optionType,
  });
  if ('error' in priced) throw new OptionsError('PRICING_FAILED', priced.error, 400);

  return {
    symbol: market.symbol,
    underlying: market.underlying,
    optionType: market.optionType,
    strike: market.strikePrice,
    spot,
    timeToExpiryYears,
    volatility,
    riskFreeRate: riskFreeRate(),
    greeks: priced,
    mark: priced.price,
    settlementAsset: market.settlementAsset,
  };
}

/** The implied volatility implied by a traded premium, or null when unbounded. */
export function impliedVolFor(market: OptionsMarket, premium: number, nowMs: number = Date.now()): number | null {
  const spot = underlyingSpot(market.underlying);
  if (spot === null) return null;
  const timeToExpiry = Math.max(0, (market.expiryNs / 1e6 - nowMs) / (365 * 24 * 60 * 60 * 1000));
  return impliedVolatility(
    {
      spot,
      strike: market.strikePrice,
      timeToExpiry,
      riskFreeRate: riskFreeRate(),
      type: market.optionType,
    },
    premium,
  );
}

export interface OptionsPositionView {
  positionId: string;
  symbol: string;
  underlying: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  premiumPaid: number;
  realizedPnl: number;
  notional: number;
  marketValue: number;
  unrealizedPnl: number;
  status: string;
  openedAt: string;
}

function toPosition(row: Record<string, unknown>): OptionsPositionView {
  const quantity = Number(row.quantity) || 0;
  const entry = Number(row.entry_price) || 0;
  const mark = Number(row.mark_price) || 0;
  const side = row.side === 'short' ? 'short' : 'long';
  const direction = side === 'long' ? 1 : -1;
  return {
    positionId: String(row.position_id),
    symbol: String(row.symbol),
    underlying: String(row.underlying ?? ''),
    side,
    quantity,
    entryPrice: entry,
    markPrice: mark,
    premiumPaid: Number(row.premium_paid) || 0,
    realizedPnl: Number(row.realized_pnl) || 0,
    notional: quantity * mark,
    marketValue: quantity * mark * direction,
    unrealizedPnl: (mark - entry) * quantity * direction,
    status: String(row.status),
    openedAt: String(row.opened_at),
  };
}

/** The caller's options positions, newest first. */
export function listPositions(userId: string, options: { status?: string } = {}): OptionsPositionView[] {
  const clauses = ['p.user_id = ?'];
  const params: Array<string | number> = [userId];
  if (options.status) {
    clauses.push('p.status = ?');
    params.push(options.status);
  } else {
    clauses.push("p.status = 'open'");
  }
  const rows = getDb()
    .prepare(
      `SELECT p.*, m.underlying FROM options_positions p
         LEFT JOIN options_markets m ON m.market_id = p.market_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY p.opened_at DESC LIMIT 500`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(toPosition);
}

export interface OpenPositionInput {
  userId: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
}

/**
 * Open an options position.
 *
 * The buyer of a long option pays the model premium plus the taker fee; a
 * writer of a short option posts the premium as collateral, so a written
 * position is never opened without the funds to cover its mark. Both legs move
 * through the ledger in one transaction with the position row.
 */
export function openPosition(input: OpenPositionInput): OptionsPositionView {
  const market = getOptionsMarket(input.symbol);
  if (!market) throw new OptionsError('UNKNOWN_CONTRACT', `${input.symbol} is not a listed contract`, 404);
  if (market.status !== 'active') throw new OptionsError('CONTRACT_INACTIVE', 'This contract is not trading', 409);
  // An expired contract has no time value and is settled, not opened; refusing
  // it here keeps a caller from buying an option that can only settle.
  if (market.expiryNs / 1e6 <= Date.now()) {
    throw new OptionsError('CONTRACT_EXPIRED', 'This contract has expired', 409);
  }

  const side = input.side === 'short' ? 'short' : input.side === 'long' ? 'long' : null;
  if (!side) throw new OptionsError('VALIDATION_FAILED', 'side must be long or short');

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new OptionsError('VALIDATION_FAILED', 'Quantity must be positive');
  }
  if (quantity < market.minQuantity || quantity > market.maxQuantity) {
    throw new OptionsError(
      'QUANTITY_OUT_OF_RANGE',
      `Quantity must be between ${market.minQuantity} and ${market.maxQuantity}`,
    );
  }

  const quote = quoteContract(market);
  const premiumPerContract = quote.mark * market.contractSize;
  const fee = premiumPerContract * quantity * (market.takerFeeBps / 10_000);

  const db = getDb();
  const positionId = generateId();
  const totalPremium = premiumPerContract * quantity;

  db.transaction(() => {
    // A long buyer pays the premium; a short writer posts it as collateral.
    debitAvailable(input.userId, market.settlementAsset, totalPremium + fee);
    recordTransaction(
      input.userId,
      side === 'long' ? 'options_buy' : 'options_write',
      market.settlementAsset,
      totalPremium + fee,
      fee,
      'completed',
      `${side} ${quantity} ${market.symbol}`,
    );

    const existing = db
      .prepare('SELECT position_id, quantity, entry_price FROM options_positions WHERE user_id = ? AND market_id = ? AND side = ?')
      .get(input.userId, market.marketId, side) as { position_id: string; quantity: number; entry_price: number } | undefined;

    if (existing) {
      const newQuantity = Number(existing.quantity) + quantity;
      const weightedEntry =
        (Number(existing.quantity) * Number(existing.entry_price) + quantity * premiumPerContract) / newQuantity;
      db.prepare(
        `UPDATE options_positions
            SET quantity = ?, entry_price = ?, mark_price = ?, premium_paid = premium_paid + ?,
                status = 'open', updated_at = datetime('now')
          WHERE position_id = ?`,
      ).run(newQuantity, weightedEntry, premiumPerContract, totalPremium, existing.position_id);
    } else {
      db.prepare(
        `INSERT INTO options_positions
           (position_id, user_id, market_id, symbol, side, quantity, entry_price, mark_price, premium_paid, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      ).run(
        positionId,
        input.userId,
        market.marketId,
        market.symbol,
        side,
        quantity,
        premiumPerContract,
        premiumPerContract,
        totalPremium,
      );
    }

    db.prepare(
      `INSERT INTO options_trades (trade_id, user_id, market_id, symbol, side, action, quantity, price, premium, fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(generateId(), input.userId, market.marketId, market.symbol, side, 'open', quantity, premiumPerContract, totalPremium, fee);
  })();

  const view = listPositions(input.userId).find((p) => p.symbol === market.symbol && p.side === side);
  if (!view) throw new OptionsError('INTERNAL_ERROR', 'The position could not be opened', 500);
  return view;
}

export interface ClosePositionInput {
  userId: string;
  symbol: string;
  side: 'long' | 'short';
  quantity?: number;
}

/**
 * Close an options position at the current model premium.
 *
 * The proceeds (long) or released collateral (short) are credited net of the
 * taker fee, and the realized P&L is the mark-versus-entry difference times the
 * closed quantity. A long position cannot be closed for less than its mark.
 */
export function closePosition(input: ClosePositionInput): { closed: number; realizedPnl: number; proceeds: number } {
  const market = getOptionsMarket(input.symbol);
  if (!market) throw new OptionsError('UNKNOWN_CONTRACT', `${input.symbol} is not a listed contract`, 404);

  const side = input.side === 'short' ? 'short' : 'long';
  const db = getDb();
  const position = db
    .prepare('SELECT * FROM options_positions WHERE user_id = ? AND market_id = ? AND side = ? AND status = ?')
    .get(input.userId, market.marketId, side, 'open') as Record<string, unknown> | undefined;
  if (!position) throw new OptionsError('NO_POSITION', 'No open position in this contract', 404);

  const held = Number(position.quantity) || 0;
  const requested = input.quantity === undefined ? held : Number(input.quantity);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new OptionsError('VALIDATION_FAILED', 'Quantity must be positive');
  }
  if (requested > held + 1e-12) {
    throw new OptionsError('INSUFFICIENT_POSITION', 'You do not hold that many contracts');
  }

  const quote = quoteContract(market);
  const markPerContract = quote.mark * market.contractSize;
  const entry = Number(position.entry_price) || 0;
  const fee = markPerContract * requested * (market.takerFeeBps / 10_000);
  const direction = side === 'long' ? 1 : -1;
  const realizedPnl = (markPerContract - entry) * requested * direction;
  // A long closes by selling the option (credit mark less fee); a short closes
  // by buying it back and releasing the collateral it posted (entry less mark).
  const proceeds =
    side === 'long' ? markPerContract * requested - fee : (entry - markPerContract) * requested - fee;

  db.transaction(() => {
    creditAvailable(input.userId, market.settlementAsset, Math.max(proceeds, 0));
    if (proceeds < 0) {
      // A short closed above its entry owes the difference.
      debitAvailable(input.userId, market.settlementAsset, -proceeds);
    }
    recordTransaction(
      input.userId,
      'options_close',
      market.settlementAsset,
      Math.abs(proceeds),
      fee,
      'completed',
      `close ${requested} ${market.symbol}`,
    );

    const remaining = held - requested;
    if (remaining <= 1e-12) {
      db.prepare(
        `UPDATE options_positions SET quantity = 0, status = 'closed', realized_pnl = realized_pnl + ?,
             updated_at = datetime('now') WHERE position_id = ?`,
      ).run(realizedPnl, position.position_id);
    } else {
      db.prepare(
        'UPDATE options_positions SET quantity = ?, mark_price = ?, updated_at = datetime(\'now\') WHERE position_id = ?',
      ).run(remaining, markPerContract, position.position_id);
    }

    db.prepare(
      `INSERT INTO options_trades (trade_id, user_id, market_id, symbol, side, action, quantity, price, premium, fee, realized_pnl)
       VALUES (?, ?, ?, ?, ?, 'close', ?, ?, ?, ?, ?)`,
    ).run(generateId(), input.userId, market.marketId, market.symbol, side, requested, markPerContract, markPerContract * requested, fee, realizedPnl);
  })();

  return { closed: requested, realizedPnl, proceeds };
}

export interface SettlementResult {
  symbol: string;
  settlementPrice: number;
  settled: number;
  totalValue: number;
}

/**
 * Settle every open position in an expired contract.
 *
 * The settlement price is the venue's spot for the underlying at expiry; each
 * holder receives the intrinsic value (long) or pays it (short). Settling is
 * idempotent because the position is marked settled inside the transaction, so
 * a repeated call settles nothing further.
 */
export function settleExpired(market: OptionsMarket, nowMs: number = Date.now()): SettlementResult {
  if (market.expiryNs / 1e6 > nowMs) {
    throw new OptionsError('NOT_EXPIRED', 'This contract has not expired', 409);
  }
  const settlementPrice = underlyingSpot(market.underlying);
  if (settlementPrice === null || settlementPrice <= 0) {
    throw new OptionsError('NO_SETTLEMENT_PRICE', `No settlement price for ${market.underlying}`, 503);
  }

  const db = getDb();
  const positions = db
    .prepare('SELECT * FROM options_positions WHERE market_id = ? AND status = ?')
    .all(market.marketId, 'open') as Array<Record<string, unknown>>;

  let totalValue = 0;
  let settled = 0;

  db.transaction(() => {
    for (const position of positions) {
      const quantity = Number(position.quantity) || 0;
      const entry = Number(position.entry_price) || 0;
      const side = position.side === 'short' ? 'short' : 'long';
      const intrinsicPerContract =
        settlementValue(market.optionType, market.strikePrice, settlementPrice, market.contractSize) *
        (side === 'long' ? 1 : -1);
      const value = intrinsicPerContract * quantity;
      const realizedPnl = value - entry * quantity * (side === 'long' ? 1 : -1);

      // A writer posted the premium as collateral at open, so settlement first
      // returns that collateral and then settles the intrinsic. An out-of-the-
      // money writer keeps the collateral in full (only the open fee is lost);
      // an in-the-money writer keeps the remainder after paying the intrinsic.
      // A writer that cannot cover the intrinsic forfeits the collateral and is
      // recorded as settled with the debt, rather than leaving the position
      // open — that shortfall is the venue's credit risk.
      const returnedCollateral = side === 'short' ? Math.max(0, entry * quantity - Math.max(-value, 0)) : 0;
      if (side === 'short') {
        if (returnedCollateral > 0) {
          creditAvailable(String(position.user_id), market.settlementAsset, returnedCollateral);
        }
      } else if (value > 0) {
        creditAvailable(String(position.user_id), market.settlementAsset, value);
      }

      db.prepare(
        `UPDATE options_positions
            SET status = 'settled', mark_price = ?, settlement_price = ?, settlement_value = ?,
                realized_pnl = realized_pnl + ?, settled_at = datetime('now'), updated_at = datetime('now')
          WHERE position_id = ?`,
      ).run(intrinsicPerContract, settlementPrice, value, realizedPnl, position.position_id);

      db.prepare(
        `INSERT INTO options_trades (trade_id, user_id, market_id, symbol, side, action, quantity, price, premium, fee, realized_pnl)
         VALUES (?, ?, ?, ?, ?, 'settle', ?, ?, ?, 0, ?)`,
      ).run(generateId(), position.user_id, market.marketId, market.symbol, side, quantity, intrinsicPerContract, value, realizedPnl);

      recordTransaction(
        String(position.user_id),
        'options_settle',
        market.settlementAsset,
        Math.abs(value),
        0,
        'completed',
        `settle ${market.symbol}`,
      );

      totalValue += value;
      settled += 1;
    }
  })();

  return { symbol: market.symbol, settlementPrice, settled, totalValue };
}

/** Settlement and exercise records for the caller. */
export function tradeHistory(userId: string, limit = 100): Array<Record<string, unknown>> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  return getDb()
    .prepare('SELECT * FROM options_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, bounded) as Array<Record<string, unknown>>;
}
