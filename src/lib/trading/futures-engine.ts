/**
 * Perpetual futures engine.
 *
 * A position is opened by reserving margin in the contract's settlement asset
 * and closed by returning that margin plus the realized P&L. Contract
 * parameters come from the admin-listed `futures_markets` row and the risk
 * tiers from `risk_limits`, so leverage, maintenance margin and the liquidation
 * threshold are whatever the venue configured, not constants.
 *
 * The mark price is the venue's own: the latest settled funding mark, the
 * published index, or the last spot price, in that order. When none exists the
 * order is refused, because a position cannot be opened or closed at a price
 * that does not exist.
 */

import { getDb, generateId } from '@/lib/db';
import {
  availableBalance,
  lockAvailable,
  creditAvailable,
  debitAvailable,
  consumeLocked,
  unlockAvailable,
  recordTransaction,
  covers,
  LedgerError,
} from '@/lib/db/ledger';
import { positionRisk, selectRiskTier, type RiskTier } from '@/lib/risk/engine';
import { futuresRates } from '@/lib/trading/spot-engine';
import { markPriceForContract, indexPriceFor } from '@/lib/trading/mark-price';
import { fundingPayment } from '@/lib/oracle/aggregator';

export class FuturesError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

interface MarketRow {
  market_id: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  settlement_asset: string;
  contract_type: string;
  listing_type: string;
  contract_size: number;
  tick_size: number;
  min_quantity: number;
  max_quantity: number;
  max_leverage: number;
  maker_fee_bps: number;
  taker_fee_bps: number;
  funding_interval_hours: number;
  funding_rate_cap: number;
  maintenance_margin_rate: number;
  initial_margin_rate: number;
  liquidation_fee_rate: number;
  insurance_fund_share: number;
  delivery_time_ns: number | null;
  status: string;
}

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
  position_mode: string;
  margin: number;
  liquidation_price: number;
  unrealized_pnl: number;
  realized_pnl: number;
  status: string;
  opened_at: string;
}

function loadMarket(symbol: string): MarketRow {
  const row = getDb()
    .prepare("SELECT * FROM futures_markets WHERE symbol = ? AND status = 'active'")
    .get(symbol.trim().toUpperCase()) as MarketRow | undefined;
  if (!row) throw new FuturesError('UNKNOWN_MARKET', `${symbol} is not listed for futures trading`, 404);
  return row;
}

/**
 * The venue's mark price for a contract, or null when none exists.
 *
 * The mark is built from the oracle index blended with the venue's own spot
 * book. When no source can publish an index the last settled funding mark is
 * the fallback, and when there is not even that the caller gets null so the
 * order is refused rather than priced from a guess.
 */
export function markPriceFor(symbol: string): number | null {
  const normalized = symbol.trim().toUpperCase();

  const derived = markPriceForContract(normalized);
  if (derived) return derived.mark;

  const funding = getDb()
    .prepare('SELECT mark_price FROM funding_rates WHERE symbol = ? ORDER BY funding_time_ns DESC LIMIT 1')
    .get(normalized) as { mark_price: number } | undefined;
  const fromFunding = Number(funding?.mark_price);
  if (Number.isFinite(fromFunding) && fromFunding > 0) return fromFunding;

  return null;
}

/** Risk tiers configured for a contract, ascending by tier. */
export function riskTiers(symbol: string): RiskTier[] {
  const rows = getDb()
    .prepare('SELECT tier, max_position_notional, max_leverage, maintenance_margin_rate FROM risk_limits WHERE symbol = ? ORDER BY tier')
    .all(symbol.trim().toUpperCase()) as Array<{
    tier: number;
    max_position_notional: number;
    max_leverage: number;
    maintenance_margin_rate: number;
  }>;

  return rows.map((row) => ({
    tier: row.tier,
    maxPositionNotional: row.max_position_notional,
    maxLeverage: row.max_leverage,
    maintenanceMarginRate: row.maintenance_margin_rate,
  }));
}

/**
 * Effective leverage and maintenance margin for a position.
 *
 * A configured tier overrides the contract default, and a requested leverage
 * above what the tier permits is capped rather than accepted.
 */
function resolveRisk(
  market: MarketRow,
  notional: number,
  requestedLeverage: number,
): { leverage: number; maintenanceMarginRate: number } {
  const tiers = riskTiers(market.symbol);
  if (tiers.length > 0) {
    const tier = selectRiskTier(tiers, notional);
    if (!('error' in tier)) {
      const leverage = Math.min(requestedLeverage, tier.maxLeverage, market.max_leverage);
      return { leverage, maintenanceMarginRate: tier.maintenanceMarginRate };
    }
    throw new FuturesError('RISK_LIMIT_EXCEEDED', 'Position notional exceeds the configured risk limits');
  }

  return {
    leverage: Math.min(requestedLeverage, market.max_leverage),
    maintenanceMarginRate: Number(market.maintenance_margin_rate),
  };
}

export interface FuturesOrderInput {
  symbol: string;
  side: 'buy' | 'sell';
  /** Hedge mode records long and short separately; one-way uses 'both'. */
  positionSide?: 'long' | 'short' | 'both';
  type: 'limit' | 'market';
  price?: number;
  quantity: number;
  leverage?: number;
  marginMode?: 'cross' | 'isolated';
  reduceOnly?: boolean;
}

export interface FuturesFillResult {
  position: {
    positionId: string;
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    markPrice: number;
    leverage: number;
    margin: number;
    liquidationPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    status: string;
  };
  action: 'opened' | 'increased' | 'reduced' | 'closed';
  fee: number;
  realizedPnl: number;
}

/**
 * Place a futures order.
 *
 * The order either opens or increases a position (locking the required margin)
 * or reduces and closes it (returning margin plus realized P&L). Reduce-only
 * orders can never flip a position's side.
 */
export function placeFuturesOrder(userId: string, input: FuturesOrderInput): FuturesFillResult {
  const market = loadMarket(input.symbol);
  const mark = markPriceFor(market.symbol);
  if (mark === null) {
    throw new FuturesError('NO_MARK_PRICE', `${market.symbol} has no mark price; trading is refused`, 409);
  }

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new FuturesError('VALIDATION_FAILED', 'quantity must be a positive number');
  }
  if (quantity < Number(market.min_quantity) || quantity > Number(market.max_quantity)) {
    throw new FuturesError(
      'VALIDATION_FAILED',
      `quantity must be between ${market.min_quantity} and ${market.max_quantity}`,
    );
  }

  const type = input.type === 'market' ? 'market' : 'limit';
  let price = mark;
  if (type === 'limit') {
    const requested = Number(input.price);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new FuturesError('VALIDATION_FAILED', 'a limit order requires a positive price');
    }
    const tick = Number(market.tick_size);
    if (Number.isFinite(tick) && tick > 0) {
      const steps = requested / tick;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) {
        throw new FuturesError('INVALID_TICK', `Price must be a multiple of the tick size ${tick}`);
      }
    }
    price = requested;
  }

  const marginMode = input.marginMode === 'isolated' ? 'isolated' : 'cross';
  const positionMode = input.positionSide === 'long' || input.positionSide === 'short' ? 'hedge' : 'one_way';

  // The side this order acts on. In hedge mode the caller names it; in one-way
  // mode a buy is a long and a sell is a short.
  const orderSide: 'long' | 'short' =
    positionMode === 'hedge' ? (input.positionSide as 'long' | 'short') : input.side === 'buy' ? 'long' : 'short';

  const settlement = market.settlement_asset;
  const contractSize = Number(market.contract_size) || 1;
  const notional = price * quantity * contractSize;

  const db = getDb();
  // Hedge mode keeps a long and a short book per contract; one-way mode keeps a
  // single position, so the lookup must not be filtered by the order's side.
  const existing =
    positionMode === 'hedge'
      ? (db
          .prepare(
            `SELECT * FROM futures_positions
              WHERE user_id = ? AND symbol = ? AND side = ? AND position_mode = 'hedge' AND status = 'open'`,
          )
          .get(userId, market.symbol, orderSide) as PositionRow | undefined)
      : (db
          .prepare(
            `SELECT * FROM futures_positions
              WHERE user_id = ? AND symbol = ? AND position_mode = 'one_way' AND status = 'open'`,
          )
          .get(userId, market.symbol) as PositionRow | undefined);

  const reduceOnly = input.reduceOnly === true;
  if (reduceOnly && !existing) {
    throw new FuturesError('NO_POSITION', 'A reduce-only order needs an open position');
  }

  // An order that opposes the open position reduces it; one that matches it
  // increases it.
  const reducing = Boolean(existing) && existing!.side !== orderSide;

  // The fill is charged the account's own tier rate; the market's configured
  // bps are the fallback when no fee schedule is installed.
  const rates = futuresRates(userId);
  const feeBps = rates.taker > 0 ? rates.taker * 10000 : Number(market.taker_fee_bps);
  const takerFee = (notional * feeBps) / 10000;

  if (reducing) {
    return reducePosition(db, market, existing!, quantity, price, takerFee, mark);
  }
  return openOrIncrease(
    db,
    market,
    userId,
    existing,
    orderSide,
    positionMode,
    marginMode,
    quantity,
    price,
    notional,
    takerFee,
    input.leverage,
    settlement,
    contractSize,
    mark,
  );
}

function openOrIncrease(
  db: ReturnType<typeof getDb>,
  market: MarketRow,
  userId: string,
  existing: PositionRow | undefined,
  side: 'long' | 'short',
  positionMode: string,
  marginMode: string,
  quantity: number,
  price: number,
  notional: number,
  fee: number,
  requestedLeverage: number | undefined,
  settlement: string,
  contractSize: number,
  mark: number,
): FuturesFillResult {
  const leverage = Number.isFinite(Number(requestedLeverage)) && Number(requestedLeverage) > 0
    ? Number(requestedLeverage)
    : existing
      ? Number(existing.leverage)
      : 10;

  const risk = resolveRisk(market, notional, leverage);
  const requiredMargin = notional / risk.leverage;

  if (!covers(availableBalance(userId, settlement), requiredMargin + fee)) {
    throw new FuturesError('INSUFFICIENT_MARGIN', `Insufficient ${settlement} margin`);
  }

  const newQuantity = (existing ? Number(existing.quantity) : 0) + quantity;
  const newEntry =
    existing && Number(existing.quantity) > 0
      ? (Number(existing.entry_price) * Number(existing.quantity) + price * quantity) / newQuantity
      : price;
  const newMargin = (existing ? Number(existing.margin) : 0) + requiredMargin;

  const positionId = existing ? existing.position_id : generateId();
  const action: FuturesFillResult['action'] = existing ? 'increased' : 'opened';

  const riskView = positionRisk({
    side,
    quantity: newQuantity,
    entryPrice: newEntry,
    markPrice: mark,
    leverage: risk.leverage,
    margin: newMargin,
    maintenanceMarginRate: risk.maintenanceMarginRate,
  });
  const liquidationPrice = 'error' in riskView ? 0 : riskView.liquidationPrice;

  try {
    const run = db.transaction(() => {
      lockAvailable(userId, settlement, requiredMargin);
      debitAvailable(userId, settlement, fee);
      if (existing) {
        db.prepare(
          `UPDATE futures_positions
              SET quantity = ?, entry_price = ?, mark_price = ?, leverage = ?, margin = ?,
                  margin_mode = ?, liquidation_price = ?, updated_at = datetime('now')
            WHERE position_id = ?`,
        ).run(newQuantity, newEntry, mark, risk.leverage, newMargin, marginMode, liquidationPrice, positionId);
      } else {
        db.prepare(
          `INSERT INTO futures_positions
             (position_id, user_id, symbol, side, quantity, entry_price, mark_price, leverage,
              margin_mode, position_mode, margin, liquidation_price, unrealized_pnl, realized_pnl, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'open')`,
        ).run(
          positionId,
          userId,
          market.symbol,
          side,
          newQuantity,
          newEntry,
          mark,
          risk.leverage,
          marginMode,
          positionMode,
          newMargin,
          liquidationPrice,
        );
      }
      recordTransaction(
        userId,
        'futures_open',
        settlement,
        requiredMargin,
        fee,
        'completed',
        `${action === 'opened' ? 'Open' : 'Increase'} ${side} ${quantity} ${market.symbol} @ ${price}`,
      );
    });
    run();
  } catch (error) {
    if (error instanceof LedgerError) throw new FuturesError(error.code, error.message, error.status);
    throw error;
  }

  const row = db.prepare('SELECT * FROM futures_positions WHERE position_id = ?').get(positionId) as PositionRow;
  return { position: toPosition(row), action, fee, realizedPnl: 0 };
}

function reducePosition(
  db: ReturnType<typeof getDb>,
  market: MarketRow,
  existing: PositionRow,
  quantity: number,
  price: number,
  fee: number,
  mark: number,
): FuturesFillResult {
  const userId = existing.user_id;
  const direction = existing.side === 'long' ? 1 : -1;
  const closeQuantity = Math.min(quantity, Number(existing.quantity));
  const entry = Number(existing.entry_price);
  const contractSize = Number(market.contract_size) || 1;

  const grossPnl = (price - entry) * closeQuantity * direction * contractSize;
  const releasedMargin = Number(existing.margin) * (closeQuantity / Number(existing.quantity));
  const remainingQuantity = Number(existing.quantity) - closeQuantity;
  const closing = remainingQuantity <= 1e-9;

  const settlement = market.settlement_asset;

  try {
    const run = db.transaction(() => {
      // The margin that backed the closed quantity returns to available; the
      // P&L is then added or subtracted and the fee is charged on top. A zero
      // P&L or fee is a no-op rather than a zero-amount ledger movement.
      if (releasedMargin > 0) {
        consumeLocked(userId, settlement, releasedMargin);
        creditAvailable(userId, settlement, releasedMargin);
      }
      if (grossPnl > 0) {
        creditAvailable(userId, settlement, grossPnl);
      } else if (grossPnl < 0) {
        debitAvailable(userId, settlement, -grossPnl);
      }
      if (fee > 0) debitAvailable(userId, settlement, fee);

      db.prepare(
        `UPDATE futures_positions
            SET quantity = ?, margin = ?, realized_pnl = realized_pnl + ?, mark_price = ?,
                status = ?, updated_at = datetime('now')
          WHERE position_id = ?`,
      ).run(
        closing ? 0 : remainingQuantity,
        closing ? 0 : Number(existing.margin) - releasedMargin,
        grossPnl - fee,
        mark,
        closing ? 'closed' : 'open',
        existing.position_id,
      );
      recordTransaction(
        userId,
        closing ? 'futures_close' : 'futures_reduce',
        settlement,
        closeQuantity,
        fee,
        'completed',
        `${closing ? 'Close' : 'Reduce'} ${existing.side} ${closeQuantity} ${market.symbol} @ ${price}`,
      );
    });
    run();
  } catch (error) {
    if (error instanceof LedgerError) throw new FuturesError(error.code, error.message, error.status);
    throw error;
  }

  const row = db.prepare('SELECT * FROM futures_positions WHERE position_id = ?').get(existing.position_id) as PositionRow;
  return {
    position: toPosition(row),
    action: closing ? 'closed' : 'reduced',
    fee,
    realizedPnl: grossPnl - fee,
  };
}

function toPosition(row: PositionRow): FuturesFillResult['position'] {
  return {
    positionId: row.position_id,
    symbol: row.symbol,
    side: row.side,
    quantity: Number(row.quantity),
    entryPrice: Number(row.entry_price),
    markPrice: Number(row.mark_price),
    leverage: Number(row.leverage),
    margin: Number(row.margin),
    liquidationPrice: Number(row.liquidation_price),
    unrealizedPnl: Number(row.unrealized_pnl),
    realizedPnl: Number(row.realized_pnl),
    status: row.status,
  };
}

/** Open positions for a user, optionally filtered to one symbol. */
export function listPositions(userId: string, symbol: string | null): PositionRow[] {
  const params: string[] = [userId];
  let where = "user_id = ? AND status = 'open'";
  if (symbol) {
    where += ' AND symbol = ?';
    params.push(symbol.trim().toUpperCase());
  }
  return getDb()
    .prepare(`SELECT * FROM futures_positions WHERE ${where} ORDER BY opened_at DESC`)
    .all(...params) as PositionRow[];
}

/**
 * Close an open position at its current mark price.
 *
 * The whole remaining quantity is closed, so the caller ends flat. Pricing at
 * the mark means the close cannot be used to pick a favourable historical
 * price, and the fee is the account's own taker rate.
 */
export function closePosition(userId: string, positionId: string): FuturesFillResult {
  const id = String(positionId ?? '').trim();
  if (!id) throw new FuturesError('VALIDATION_FAILED', 'positionId is required');

  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM futures_positions WHERE position_id = ? AND user_id = ? AND status = 'open'")
    .get(id, userId) as PositionRow | undefined;
  if (!existing) throw new FuturesError('NO_POSITION', 'No open position with that id', 404);

  const market = loadMarket(existing.symbol);
  const mark = markPriceFor(market.symbol);
  if (mark === null) {
    throw new FuturesError('NO_MARK_PRICE', `${market.symbol} has no mark price; the close is refused`, 409);
  }

  const rates = futuresRates(userId);
  const feeBps = rates.taker > 0 ? rates.taker * 10000 : Number(market.taker_fee_bps);
  const notional = mark * Number(existing.quantity) * (Number(market.contract_size) || 1);
  const fee = (notional * feeBps) / 10000;

  return reducePosition(db, market, existing, Number(existing.quantity), mark, fee, mark);
}

/** Set the leverage on an open position, refusing a value the venue does not allow. */
export function setLeverage(userId: string, symbol: string, leverage: number): PositionRow {
  const market = loadMarket(symbol);
  const requested = Number(leverage);
  if (!Number.isFinite(requested) || requested < 1) {
    throw new FuturesError('VALIDATION_FAILED', 'leverage must be a number of at least 1');
  }

  const row = getDb()
    .prepare("SELECT * FROM futures_positions WHERE user_id = ? AND symbol = ? AND status = 'open'")
    .get(userId, market.symbol) as PositionRow | undefined;
  if (!row) throw new FuturesError('NO_POSITION', 'No open position for this contract', 404);

  const notional = Number(row.entry_price) * Number(row.quantity) * (Number(market.contract_size) || 1);
  const risk = resolveRisk(market, notional, requested);
  if (risk.leverage < requested) {
    throw new FuturesError(
      'LEVERAGE_EXCEEDED',
      `Requested leverage ${requested} exceeds the maximum ${risk.leverage} for this notional`,
    );
  }

  const requiredMargin = notional / risk.leverage;
  const settlement = market.settlement_asset;
  const extra = requiredMargin - Number(row.margin);

  if (extra > 0 && !covers(availableBalance(userId, settlement), extra)) {
    throw new FuturesError('INSUFFICIENT_MARGIN', `Insufficient ${settlement} to raise leverage`);
  }

  const riskView = positionRisk({
    side: row.side === 'long' ? 'long' : 'short',
    quantity: Number(row.quantity),
    entryPrice: Number(row.entry_price),
    markPrice: Number(row.mark_price),
    leverage: risk.leverage,
    margin: requiredMargin,
    maintenanceMarginRate: risk.maintenanceMarginRate,
  });

  try {
    const run = getDb().transaction(() => {
      if (extra > 0) lockAvailable(userId, settlement, extra);
      else if (extra < 0) unlockAvailable(userId, settlement, -extra);
      getDb()
        .prepare(
          `UPDATE futures_positions SET leverage = ?, margin = ?, liquidation_price = ?,
                  updated_at = datetime('now') WHERE position_id = ?`,
        )
        .run(
          risk.leverage,
          requiredMargin,
          'error' in riskView ? Number(row.liquidation_price) : riskView.liquidationPrice,
          row.position_id,
        );
    });
    run();
  } catch (error) {
    if (error instanceof LedgerError) throw new FuturesError(error.code, error.message, error.status);
    throw error;
  }

  return getDb().prepare('SELECT * FROM futures_positions WHERE position_id = ?').get(row.position_id) as PositionRow;
}

/**
 * Settle one funding interval for a contract.
 *
 * The rate is clamped to the contract's cap. A long pays when the rate is
 * positive and receives when it is negative; a short takes the other side. The
 * premium and the mark and index prices are persisted with the rate so the
 * funding history is auditable.
 */
export function applyFunding(
  symbol: string,
  rate: number,
  indexPrice?: number,
): { rate: number; markPrice: number; indexPrice: number; positions: number } {
  const market = loadMarket(symbol);
  const mark = markPriceFor(market.symbol);
  if (mark === null) throw new FuturesError('NO_MARK_PRICE', 'Cannot fund a contract with no mark price', 409);

  const cap = Number(market.funding_rate_cap);
  const requested = Number(rate);
  if (!Number.isFinite(requested)) throw new FuturesError('VALIDATION_FAILED', 'rate must be a number');
  const clamped = Math.max(-cap, Math.min(cap, requested));

  // Prefer the supplied index; otherwise use the venue's own aggregated index.
  const published = indexPriceFor(market.symbol);
  const supplied = Number(indexPrice);
  const index =
    Number.isFinite(supplied) && supplied > 0
      ? supplied
      : 'error' in published
        ? mark
        : published.price;
  const premium = index > 0 ? (mark - index) / index : 0;

  const db = getDb();
  const positions = db
    .prepare("SELECT * FROM futures_positions WHERE symbol = ? AND status = 'open'")
    .all(market.symbol) as PositionRow[];

  const fundingId = generateId();
  const contractSize = Number(market.contract_size) || 1;

  const run = db.transaction(() => {
    for (const position of positions) {
      const notional = Number(position.mark_price) * Number(position.quantity) * contractSize;
      // A negative payment is what the position owes; a positive one is what it
      // receives. `fundingPayment` already applies the long/short direction.
      const payment = fundingPayment(notional, clamped, position.side === 'long' ? 'long' : 'short');
      if (payment === 0) continue;

      const settlement = market.settlement_asset;
      if (payment < 0) {
        const owed = -payment;
        if (availableBalance(position.user_id, settlement) + 1e-9 < owed) {
          // The position cannot pay funding; the loss is booked against margin.
          const payable = Math.min(owed, Number(position.margin));
          consumeLocked(position.user_id, settlement, payable);
          db.prepare('UPDATE futures_positions SET margin = margin - ? WHERE position_id = ?').run(
            payable,
            position.position_id,
          );
          addToInsuranceFund(market.symbol, payable);
        } else {
          debitAvailable(position.user_id, settlement, owed);
          addToInsuranceFund(market.symbol, owed);
        }
      } else {
        creditAvailable(position.user_id, settlement, payment);
      }
      recordTransaction(
        position.user_id,
        'funding',
        settlement,
        Math.abs(payment),
        0,
        'completed',
        `Funding ${payment < 0 ? 'paid' : 'received'} on ${market.symbol} at ${clamped}`,
      );
    }

    db.prepare(
      `INSERT INTO funding_rates
         (funding_id, symbol, funding_rate, mark_price, index_price, premium, funding_time_ns)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(fundingId, market.symbol, clamped, mark, index, premium, Date.now() * 1_000_000);
  });

  try {
    run();
  } catch (error) {
    if (error instanceof LedgerError) throw new FuturesError(error.code, error.message, error.status);
    throw error;
  }

  return { rate: clamped, markPrice: mark, indexPrice: index, positions: positions.length };
}

function addToInsuranceFund(symbol: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const db = getDb();
  const existing = db.prepare('SELECT 1 FROM insurance_funds WHERE contract = ?').get(symbol);
  if (!existing) {
    db.prepare('INSERT INTO insurance_funds (contract, balance) VALUES (?, 0)').run(symbol);
  }
  db.prepare("UPDATE insurance_funds SET balance = balance + ?, updated_at = datetime('now') WHERE contract = ?").run(
    amount,
    symbol,
  );
}
