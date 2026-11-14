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
import {
  recordFee,
  recordFunding,
  recordFuturesClose,
  recordFuturesLiquidation,
  recordBalanced,
  recordInsuranceShare,
  futuresPoolAccount,
  insuranceAccount,
} from '@/lib/db/accounting';
import { positionRisk, selectRiskTier, type RiskTier } from '@/lib/risk/engine';
import { futuresRates } from '@/lib/trading/spot-engine';
import { pausedScope, pauseMessage } from '@/lib/trading/controls';
import { markPriceForContract, indexPriceFor } from '@/lib/trading/mark-price';
import { fundingPayment } from '@/lib/oracle/aggregator';
import {
  isInverseContract,
  notionalUsd,
  positionValue,
  unrealizedPnl as unrealizedPnlOf,
} from '@/lib/trading/contract-math';
import { recordRevenue } from '@/lib/trading/revenue';

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
  const paused = pausedScope('futures');
  if (paused) throw new FuturesError('TRADING_PAUSED', pauseMessage(paused), 409);
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
  const inverse = isInverseContract(market.contract_type);
  // The notional is quoted in USD for both contract kinds; an inverse
  // contract's size is already USD, so its notional does not scale with price.
  const notional = notionalUsd(quantity, price, contractSize, inverse);

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
  // The fee is charged in the settlement asset, so an inverse contract's USD
  // notional is converted to coin before the rate is applied.
  const feeNotional = inverse ? positionValue(quantity, price, contractSize, inverse) : notional;
  const takerFee = (feeNotional * feeBps) / 10000;

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
    inverse,
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
  inverse: boolean,
  mark: number,
): FuturesFillResult {
  const leverage = Number.isFinite(Number(requestedLeverage)) && Number(requestedLeverage) > 0
    ? Number(requestedLeverage)
    : existing
      ? Number(existing.leverage)
      : 10;

  const risk = resolveRisk(market, notional, leverage);
  // Margin is denominated in the settlement asset: for an inverse contract the
  // USD notional is divided by the price to reach coin.
  const requiredMargin = positionValue(quantity, price, contractSize, inverse) / risk.leverage;

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
    contractSize,
    inverse,
  });
  const liquidationPrice = 'error' in riskView ? 0 : riskView.liquidationPrice;

  try {
    const run = db.transaction(() => {
      lockAvailable(userId, settlement, requiredMargin);
      debitAvailable(userId, settlement, fee);
      recordFee(userId, settlement, fee, `Open fee ${market.symbol}`);
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
      accrueFeeRevenue(db, market, fee, userId);
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
  const closeQuantity = Math.min(quantity, Number(existing.quantity));
  const entry = Number(existing.entry_price);
  const contractSize = Number(market.contract_size) || 1;
  const inverse = isInverseContract(market.contract_type);

  // Realised P&L in the settlement asset. A linear contract moves with the
  // price difference; an inverse one is worth more coin as the price falls, so
  // a short gains when the price rises. Getting this wrong overpays a winning
  // short and underpays a losing long.
  const grossPnl = unrealizedPnlOf({
    inverse,
    side: existing.side === 'long' ? 'long' : 'short',
    quantity: closeQuantity,
    entryPrice: entry,
    markPrice: price,
    contractSize,
  });
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
      // The margin release above is net-zero (locked -> available). The realised
      // PnL is settled against the venue's counterparty pool and the fee accrues
      // to the venue; the journal records both.
      recordFuturesClose(userId, settlement, market.symbol, grossPnl, fee, `Close ${market.symbol}`);

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
      accrueFeeRevenue(db, market, fee, userId);
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
  const contractSize = Number(market.contract_size) || 1;
  const inverse = isInverseContract(market.contract_type);
  const feeNotional = positionValue(Number(existing.quantity), mark, contractSize, inverse);
  const fee = (feeNotional * feeBps) / 10000;

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

  const contractSize = Number(market.contract_size) || 1;
  const inverse = isInverseContract(market.contract_type);
  const notional = notionalUsd(Number(row.quantity), Number(row.entry_price), contractSize, inverse);
  const risk = resolveRisk(market, notional, requested);
  if (risk.leverage < requested) {
    throw new FuturesError(
      'LEVERAGE_EXCEEDED',
      `Requested leverage ${requested} exceeds the maximum ${risk.leverage} for this notional`,
    );
  }

  const requiredMargin = positionValue(Number(row.quantity), Number(row.entry_price), contractSize, inverse) / risk.leverage;
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
    contractSize,
    inverse,
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
  const settlement = market.settlement_asset;

  const run = db.transaction(() => {
    // Funding is zero-sum between the two sides: what one side pays the other
    // receives. A payer's money is routed to the receivers and only the surplus
    // (a payer who cannot settle) goes to the insurance fund. A receiver is paid
    // from that pot — never credited out of thin air — so the book cannot mint
    // the settlement asset.
    const payments = positions.map((position) => {
      const notional = notionalUsd(
        Number(position.quantity),
        Number(position.mark_price),
        contractSize,
        isInverseContract(market.contract_type),
      );
      // A negative payment is what the position owes; a positive one is what it
      // receives. `fundingPayment` already applies the long/short direction.
      return fundingPayment(notional, clamped, position.side === 'long' ? 'long' : 'short');
    });

    // Collect from each payer what it can actually settle, smallest debt first so
    // a small balance is never skipped in favour of a larger one.
    const payerEntries = payments
      .map((payment, index) => ({ payment, index }))
      .filter((entry) => entry.payment < 0)
      .map((entry) => ({ index: entry.index, owed: -entry.payment }))
      .sort((a, b) => a.owed - b.owed);

    let pot = 0;
    for (const { index, owed } of payerEntries) {
      const payer = positions[index];
      if (availableBalance(payer.user_id, settlement) + 1e-9 >= owed) {
        debitAvailable(payer.user_id, settlement, owed);
        pot += owed;
        recordFunding(payer.user_id, settlement, market.symbol, -owed, `Funding paid on ${market.symbol}`);
        recordTransaction(payer.user_id, 'funding', settlement, owed, 0, 'completed', `Funding paid on ${market.symbol} at ${clamped}`);
      } else {
        // The position cannot pay funding; the loss is booked against margin and
        // whatever it can pay is added to the pot.
        const payable = Math.max(0, Math.min(owed, Number(payer.margin)));
        if (payable > 0) {
          consumeLocked(payer.user_id, settlement, payable);
          db.prepare('UPDATE futures_positions SET margin = margin - ? WHERE position_id = ?').run(payable, payer.position_id);
          pot += payable;
          recordFunding(payer.user_id, settlement, market.symbol, -payable, `Funding shortfall on ${market.symbol}`);
        }
        recordTransaction(payer.user_id, 'funding', settlement, owed, 0, 'completed', `Funding shortfall on ${market.symbol} at ${clamped}`);
      }
    }

    // Pay each receiver pro rata out of what was collected. When every payer
    // settled in full the pot equals the total owed and each receiver is made
    // whole; a shortfall scales every receiver down rather than minting.
    const totalOwedToReceivers = payments.reduce((sum, payment) => (payment > 0 ? sum + payment : sum), 0);
    const scale = totalOwedToReceivers > 0 ? Math.min(1, pot / totalOwedToReceivers) : 0;
    let paid = 0;
    for (let index = 0; index < positions.length; index += 1) {
      const amount = payments[index] > 0 ? payments[index] * scale : 0;
      if (amount <= 0) continue;
      creditAvailable(positions[index].user_id, settlement, amount);
      paid += amount;
      recordFunding(positions[index].user_id, settlement, market.symbol, amount, `Funding received on ${market.symbol}`);
      recordTransaction(positions[index].user_id, 'funding', settlement, amount, 0, 'completed', `Funding received on ${market.symbol} at ${clamped}`);
    }

    // Only a shortfall surplus (payers who could not settle) remains; it is the
    // insurance fund's, not the receivers'.
    const surplus = pot - paid;
    if (surplus > 1e-12) {
      addToInsuranceFund(market.symbol, surplus);
      recordBalanced(settlement, [
        { account: futuresPoolAccount(market.symbol), amount: -surplus },
        { account: insuranceAccount(market.symbol), amount: surplus },
      ], `Funding surplus on ${market.symbol}`);
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

/**
 * Book a charged futures fee as revenue and set aside the contract's insurance
 * share.
 *
 * The whole fee is the exchange's income and is recorded in the settlement
 * asset; the contract's `insurance_fund_share` of it is moved into the fund so a
 * bankruptcy that outruns a position's margin has a reserve to draw on. Both
 * writes run inside the caller's transaction, so revenue and the fund move
 * together or not at all.
 */
function accrueFeeRevenue(db: ReturnType<typeof getDb>, market: MarketRow, fee: number, userId: string): void {
  if (!Number.isFinite(fee) || fee <= 0) return;
  recordRevenue('futures_fee', market.settlement_asset, fee, userId, market.symbol);

  const share = Number(market.insurance_fund_share);
  if (!Number.isFinite(share) || share <= 0) return;
  const contribution = fee * Math.min(share, 1);
  if (contribution <= 0) return;
  const existing = db.prepare('SELECT 1 FROM insurance_funds WHERE contract = ?').get(market.symbol);
  if (!existing) {
    db.prepare('INSERT INTO insurance_funds (contract, balance) VALUES (?, 0)').run(market.symbol);
  }
  db.prepare("UPDATE insurance_funds SET balance = balance + ?, updated_at = datetime('now') WHERE contract = ?").run(
    contribution,
    market.symbol,
  );
  recordInsuranceShare(market.settlement_asset, market.symbol, contribution);
}

// ---------------------------------------------------------------------------
// Conditional orders (stop-loss, take-profit, trailing stop)
//
// A conditional order parks off the book until the mark price crosses its
// trigger, then closes the position it protects with a reduce-only market
// order. Every check is fail-closed: an order whose trigger or mark cannot be
// computed stays pending rather than firing on a guess.
// ---------------------------------------------------------------------------

export type ConditionalType = 'stop_loss' | 'take_profit' | 'trailing_stop';

export interface ConditionalOrderInput {
  symbol: string;
  positionSide: 'long' | 'short' | 'both';
  type: ConditionalType;
  quantity: number;
  /** Required for stop_loss and take_profit. */
  stopPrice?: number;
  /** Required for trailing_stop: the drawdown from the peak, as a fraction. */
  callbackRate?: number;
}

export interface ConditionalOrderRow {
  order_id: string;
  user_id: string;
  symbol: string;
  position_side: string;
  side: string;
  type: string;
  stop_price: number | null;
  callback_rate: number | null;
  quantity: number;
  limit_price: number | null;
  status: string;
  trigger_price: number | null;
  created_at: string;
  triggered_at: string | null;
}

export interface ConditionalOrderView {
  orderId: string;
  symbol: string;
  positionSide: string;
  side: string;
  type: string;
  stopPrice: number | null;
  callbackRate: number | null;
  quantity: number;
  status: string;
  triggerPrice: number | null;
  createdAt: string;
  triggeredAt: string | null;
}

const CONDITIONAL_TYPES: ConditionalType[] = ['stop_loss', 'take_profit', 'trailing_stop'];

function toConditional(row: ConditionalOrderRow): ConditionalOrderView {
  return {
    orderId: row.order_id,
    symbol: row.symbol,
    positionSide: row.position_side,
    side: row.side,
    type: row.type,
    stopPrice: row.stop_price === null ? null : Number(row.stop_price),
    callbackRate: row.callback_rate === null ? null : Number(row.callback_rate),
    quantity: Number(row.quantity),
    status: row.status,
    triggerPrice: row.trigger_price === null ? null : Number(row.trigger_price),
    createdAt: row.created_at,
    triggeredAt: row.triggered_at,
  };
}

/**
 * The open position a conditional order protects.
 *
 * In hedge mode the order names its side; in one-way mode the position's own
 * side is the only one that can exist. Returns undefined when there is no open
 * position, which makes the order fail closed rather than fire against nothing.
 */
function positionForConditional(userId: string, symbol: string, positionSide: string): PositionRow | undefined {
  const db = getDb();
  if (positionSide === 'long' || positionSide === 'short') {
    return db
      .prepare(
        `SELECT * FROM futures_positions
          WHERE user_id = ? AND symbol = ? AND side = ? AND status = 'open'`,
      )
      .get(userId, symbol, positionSide) as PositionRow | undefined;
  }
  return db
    .prepare("SELECT * FROM futures_positions WHERE user_id = ? AND symbol = ? AND status = 'open'")
    .get(userId, symbol) as PositionRow | undefined;
}

/**
 * Place a conditional order against an open position.
 *
 * The order closes the position it protects, so its side is the opposite of the
 * position's: a long is protected by a sell, a short by a buy. The quantity is
 * capped at the position size, because a reduce-only order can never flip the
 * position to the other side.
 */
export function placeConditionalOrder(userId: string, input: ConditionalOrderInput): ConditionalOrderView {
  const paused = pausedScope('futures');
  if (paused) throw new FuturesError('TRADING_PAUSED', pauseMessage(paused), 409);

  const market = loadMarket(input.symbol);
  const type = CONDITIONAL_TYPES.includes(input.type) ? input.type : null;
  if (type === null) {
    throw new FuturesError('VALIDATION_FAILED', `type must be one of ${CONDITIONAL_TYPES.join(', ')}`);
  }

  const positionSide = input.positionSide === 'long' || input.positionSide === 'short' ? input.positionSide : 'both';
  const position = positionForConditional(userId, market.symbol, positionSide);
  if (!position) throw new FuturesError('NO_POSITION', `No open ${market.symbol} position to protect`);

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new FuturesError('VALIDATION_FAILED', 'quantity must be a positive number');
  }
  if (quantity > Number(position.quantity) + 1e-9) {
    throw new FuturesError('VALIDATION_FAILED', 'quantity exceeds the open position');
  }

  let stopPrice: number | null = null;
  let callbackRate: number | null = null;

  if (type === 'trailing_stop') {
    const rate = Number(input.callbackRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
      throw new FuturesError('VALIDATION_FAILED', 'callbackRate must be a fraction between 0 and 1');
    }
    callbackRate = rate;
  } else {
    const requested = Number(input.stopPrice);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new FuturesError('VALIDATION_FAILED', 'stopPrice must be a positive number');
    }
    const tick = Number(market.tick_size);
    if (Number.isFinite(tick) && tick > 0) {
      const steps = requested / tick;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) {
        throw new FuturesError('INVALID_TICK', `Price must be a multiple of the tick size ${tick}`);
      }
    }
    stopPrice = requested;
  }

  // A long is closed by a sell; a short by a buy.
  const side = position.side === 'long' ? 'sell' : 'buy';
  const orderId = generateId();
  getDb()
    .prepare(
      `INSERT INTO futures_conditional_orders
         (order_id, user_id, symbol, position_side, side, type, stop_price, callback_rate, quantity, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(orderId, userId, market.symbol, position.side, side, type, stopPrice, callbackRate, quantity);

  const row = getDb().prepare('SELECT * FROM futures_conditional_orders WHERE order_id = ?').get(orderId) as ConditionalOrderRow;
  return toConditional(row);
}

/** A user's conditional orders, newest first. */
export function listConditionalOrders(userId: string, symbol: string | null): ConditionalOrderView[] {
  const params: string[] = [userId];
  let where = 'user_id = ?';
  if (symbol) {
    where += ' AND symbol = ?';
    params.push(symbol.trim().toUpperCase());
  }
  const rows = getDb()
    .prepare(`SELECT * FROM futures_conditional_orders WHERE ${where} ORDER BY created_at DESC`)
    .all(...params) as ConditionalOrderRow[];
  return rows.map(toConditional);
}

/** Cancel a pending conditional order. */
export function cancelConditionalOrder(userId: string, orderId: string): ConditionalOrderView {
  const id = String(orderId ?? '').trim();
  if (!id) throw new FuturesError('VALIDATION_FAILED', 'orderId is required');
  const db = getDb();
  const row = db.prepare('SELECT * FROM futures_conditional_orders WHERE order_id = ?').get(id) as
    | ConditionalOrderRow
    | undefined;
  if (!row) throw new FuturesError('UNKNOWN_ORDER', 'No such conditional order', 404);
  if (row.user_id !== userId) throw new FuturesError('UNKNOWN_ORDER', 'No such conditional order', 404);
  if (row.status !== 'pending') {
    throw new FuturesError('TERMINAL_STATE', `This order is already ${row.status}`, 409);
  }
  db.prepare("UPDATE futures_conditional_orders SET status = 'cancelled' WHERE order_id = ?").run(id);
  return toConditional({ ...row, status: 'cancelled' });
}

/**
 * Trigger pending conditional orders whose condition the mark price has crossed.
 *
 * A stop-loss closes the position when the mark moves against it; a take-profit
 * closes it when the mark reaches the target; a trailing stop arms on the
 * position's best price and fires once the mark retraces the callback from that
 * peak. Each triggered order closes its position at the mark, and a position
 * that has already gone is skipped rather than opening an opposite one.
 */
export function triggerConditionalOrders(): {
  triggered: Array<{ orderId: string; symbol: string; price: number; closed: boolean }>;
  skipped: string[];
} {
  const db = getDb();
  const pending = db
    .prepare("SELECT * FROM futures_conditional_orders WHERE status = 'pending'")
    .all() as ConditionalOrderRow[];

  const triggered: Array<{ orderId: string; symbol: string; price: number; closed: boolean }> = [];
  const skipped: string[] = [];

  for (const order of pending) {
    const mark = markPriceFor(order.symbol);
    if (mark === null) {
      skipped.push(order.order_id);
      continue;
    }

    const position = positionForConditional(order.user_id, order.symbol, order.position_side);
    if (!position) {
      // The position it protected is gone, so the order has nothing to do.
      db.prepare("UPDATE futures_conditional_orders SET status = 'cancelled' WHERE order_id = ?").run(order.order_id);
      continue;
    }

    const entry = Number(position.entry_price);
    let shouldTrigger = false;

    if (order.type === 'stop_loss') {
      shouldTrigger = position.side === 'long' ? mark <= Number(order.stop_price) : mark >= Number(order.stop_price);
    } else if (order.type === 'take_profit') {
      shouldTrigger = position.side === 'long' ? mark >= Number(order.stop_price) : mark <= Number(order.stop_price);
    } else {
      // Trailing: the peak (long) or trough (short) is the best price seen since
      // the order was placed, so it is carried in `trigger_price` between cycles
      // rather than recomputed from the current mark alone. It starts at the
      // entry price and only ever moves in the position's favour.
      const rate = Number(order.callback_rate);
      const stored = order.trigger_price === null ? entry : Number(order.trigger_price);
      if (position.side === 'long') {
        const peak = Math.max(stored, mark);
        db.prepare('UPDATE futures_conditional_orders SET trigger_price = ? WHERE order_id = ?').run(peak, order.order_id);
        shouldTrigger = mark <= peak * (1 - rate);
      } else {
        const trough = Math.min(stored, mark);
        db.prepare('UPDATE futures_conditional_orders SET trigger_price = ? WHERE order_id = ?').run(trough, order.order_id);
        shouldTrigger = mark >= trough * (1 + rate);
      }
    }

    if (!shouldTrigger) continue;

    const quantity = Math.min(Number(order.quantity), Number(position.quantity));
    if (quantity <= 0) {
      db.prepare("UPDATE futures_conditional_orders SET status = 'cancelled' WHERE order_id = ?").run(order.order_id);
      continue;
    }

    try {
      // Reduce the position directly rather than re-entering placeFuturesOrder,
      // so the close cannot nest a trigger check inside itself.
      const market = loadMarket(order.symbol);
      const rates = futuresRates(order.user_id);
      const feeBps = rates.taker > 0 ? rates.taker * 10000 : Number(market.taker_fee_bps);
      const contractSize = Number(market.contract_size) || 1;
      const inverse = isInverseContract(market.contract_type);
      const feeNotional = positionValue(quantity, mark, contractSize, inverse);
      const fee = (feeNotional * feeBps) / 10000;

      const run = db.transaction(() => {
        reducePosition(db, market, position, quantity, mark, fee, mark);
        db.prepare(
          "UPDATE futures_conditional_orders SET status = 'triggered', trigger_price = ?, triggered_at = datetime('now') WHERE order_id = ?",
        ).run(mark, order.order_id);
      });
      run();
      triggered.push({ orderId: order.order_id, symbol: order.symbol, price: mark, closed: true });
    } catch {
      skipped.push(order.order_id);
    }
  }

  return { triggered, skipped };
}
