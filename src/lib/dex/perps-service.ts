/**
 * TigerSwap perpetual position management.
 *
 * Opens and closes positions against a listed `futures_markets` row, moves real
 * collateral through the ledger, charges the taker fee, and liquidates a
 * position whose equity falls below its maintenance margin. The maths comes
 * from `./perps`; this module is the durable half. A position's margin is held
 * as a ledger reservation, so a trader cannot spend collateral that is backing
 * an open position.
 */

import { getDb, generateId } from '@/lib/db';
import { lockAvailable, unlockAvailable, creditAvailable, debitAvailable, covers, availableBalance, recordTransaction } from '@/lib/db/ledger';
import {
  DexError,
  dexSetting,
  recordDexRevenue,
  assertDexOpen,
  assertNotBlacklisted,
} from '@/lib/dex/pool-service';
import {
  unrealizedPnl,
  requiredMargin,
  liquidationPrice as computeLiquidationPrice,
  shouldLiquidate,
  realizedPnl,
  fundingPayment,
  liquidationPenaltySplit,
  oraclePriceImpact,
  borrowFee,
  medianMarkPrice,
  type PerpSide,
} from '@/lib/dex/perps';
import { applySchedule } from '@/lib/dex/fee-engine';
import { priceInQuote } from '@/lib/trading/valuation';

interface FuturesMarketRow {
  market_id: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  settlement_asset: string;
  contract_type: string;
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
  status: string;
}

interface PositionRow {
  position_id: string;
  user_id: string;
  market: string;
  side: string;
  size: number;
  entry_price: number;
  leverage: number;
  margin_mode: string;
  collateral: number;
  liquidation_price: number;
  status: string;
}

function loadMarket(symbol: string): FuturesMarketRow {
  const row = getDb().prepare('SELECT * FROM futures_markets WHERE symbol = ?').get(symbol.toUpperCase()) as
    | FuturesMarketRow
    | undefined;
  if (!row) throw new DexError('UNKNOWN_SYMBOL', `${symbol} is not a listed perpetual`, 404);
  if (row.status !== 'active') throw new DexError('MARKET_INACTIVE', `${symbol} is ${row.status}`, 409);
  return row;
}

/** Mark price for a symbol: the median of the stored oracle sources, else last trade. */
export function markPrice(symbol: string): number {
  const rows = getDb()
    .prepare('SELECT price FROM oracle_prices WHERE symbol = ? ORDER BY published_ns DESC LIMIT 8')
    .all(symbol) as Array<{ price: number }>;
  const prices = rows.map((r) => Number(r.price)).filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length >= 3) {
    try {
      return medianMarkPrice(prices);
    } catch {
      // Sources disagree; fall through to the valuation helper below.
    }
  }
  const [base] = symbol.split('/');
  const value = priceInQuote(base, 'RUSD');
  if (value === null || !Number.isFinite(value) || value <= 0) {
    throw new DexError('NO_PRICE', `no mark price is available for ${symbol}`, 409);
  }
  return value;
}

export interface OpenPositionRequest {
  userId: string;
  symbol: string;
  side: PerpSide;
  /** Size in base units. */
  size: number;
  leverage: number;
  /** Margin mode; only isolated is supported by the settlement path. */
  marginMode?: 'isolated' | 'cross';
}

export interface OpenPositionResult {
  positionId: string;
  symbol: string;
  side: PerpSide;
  size: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  liquidationPrice: number;
  fee: number;
}

/** Open a perpetual position, locking the required margin. */
export function openPosition(request: OpenPositionRequest): OpenPositionResult {
  assertDexOpen('dex', 'dex_perps');
  const market = loadMarket(request.symbol);
  assertNotBlacklisted([
    { kind: 'wallet', value: request.userId },
    { kind: 'token', value: market.base_asset },
  ]);
  const side = request.side;
  if (side !== 'long' && side !== 'short') throw new DexError('INVALID_SIDE', 'side must be long or short', 400);
  if (!Number.isFinite(request.size) || request.size <= 0) {
    throw new DexError('INVALID_AMOUNT', 'size must be positive', 400);
  }
  if (request.size < market.min_quantity || request.size > market.max_quantity) {
    throw new DexError('SIZE_OUT_OF_RANGE', `size must be between ${market.min_quantity} and ${market.max_quantity}`, 400);
  }
  const leverage = Number(request.leverage);
  if (!Number.isFinite(leverage) || leverage < 1 || leverage > market.max_leverage) {
    throw new DexError('INVALID_LEVERAGE', `leverage must be between 1 and ${market.max_leverage}`, 400);
  }
  const entryPrice = markPrice(market.symbol);
  const margin = requiredMargin(request.size, entryPrice, leverage);
  const notional = request.size * entryPrice;
  const fee = (notional * market.taker_fee_bps) / 10_000;
  const settlement = market.settlement_asset;

  if (!covers(availableBalance(request.userId, settlement), margin + fee)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${settlement} balance for margin and fee`, 400);
  }

  const liqPrice = computeLiquidationPrice(side, entryPrice, leverage, market.maintenance_margin_rate);
  const positionId = generateId();

  getDb().transaction(() => {
    lockAvailable(request.userId, settlement, margin);
    recordTransaction(request.userId, 'dex_perp_margin', settlement, margin, 0, 'completed', `open ${market.symbol}`);
    // The open fee leaves the account; only the margin is held for the position.
    debitAvailable(request.userId, settlement, fee);
    recordDexRevenue('dex_perp_fee', settlement, fee, applySchedule(fee, perpFeeSplit()), positionId);

    getDb()
      .prepare(
        `INSERT INTO dex_perp_positions
           (position_id, market, user_id, side, margin_mode, collateral_asset, collateral, size, entry_price, leverage, liquidation_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        positionId,
        market.symbol,
        request.userId,
        side,
        request.marginMode ?? 'isolated',
        settlement,
        margin,
        request.size,
        entryPrice,
        leverage,
        liqPrice,
      );
  })();

  return {
    positionId,
    symbol: market.symbol,
    side,
    size: request.size,
    entryPrice,
    leverage,
    margin,
    liquidationPrice: liqPrice,
    fee,
  };
}

/** The perpetual-fee split, read from settings. */
function perpFeeSplit() {
  return {
    lpBps: 0,
    vetgrBps: dexSetting('dex_perp_fee_split_vetgr_bps', 4000),
    treasuryBps: dexSetting('dex_perp_fee_split_treasury_bps', 2000),
    insuranceBps: dexSetting('dex_perp_fee_split_insurance_bps', 4000),
    burnBps: 0,
  };
}

export interface ClosePositionResult {
  positionId: string;
  exitPrice: number;
  pnl: number;
  fee: number;
  released: number;
}

/** Close a position, returning the margin plus PnL net of the close fee. */
export function closePosition(userId: string, positionId: string): ClosePositionResult {
  // Closing is never paused: a paused market must still let a trader reduce
  // risk and recover their margin.
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const position = loadPosition(userId, positionId);
  const market = loadMarket(position.market);
  const exitPrice = markPrice(position.market);
  const side = position.side as PerpSide;
  const notional = position.size * position.entry_price;
  const openFee = (notional * market.taker_fee_bps) / 10_000;
  const closeFee = (position.size * exitPrice * market.taker_fee_bps) / 10_000;
  const pnl = realizedPnl(side, position.size, position.entry_price, exitPrice, market.taker_fee_bps / 10_000, market.taker_fee_bps / 10_000);
  const released = position.collateral + pnl;

  const settlement = market.settlement_asset;
  return getDb().transaction(() => {
    unlockAvailable(userId, settlement, position.collateral);
    if (released > 0) {
      creditAvailable(userId, settlement, released);
    } else {
      // A loss beyond the margin cannot make the balance negative: the position
      // is capped at the margin it posted, which is the isolated-loss guarantee.
      creditAvailable(userId, settlement, Math.max(0, released));
    }
    recordTransaction(userId, 'dex_perp_close', settlement, Math.max(released, 0), closeFee, 'completed', `close ${position.market}`);

    const feeParts = applySchedule(Math.max(closeFee, 0), perpFeeSplit());
    recordDexRevenue('dex_perp_fee', settlement, Math.max(closeFee, 0), feeParts, positionId);

    getDb()
      .prepare("UPDATE dex_perp_positions SET status = 'closed', realized_pnl = ?, closed_at = datetime('now') WHERE position_id = ?")
      .run(pnl, positionId);
    return { positionId, exitPrice, pnl, fee: closeFee, released };
  })() as ClosePositionResult;
}

function loadPosition(userId: string, positionId: string): PositionRow {
  const row = getDb()
    .prepare("SELECT * FROM dex_perp_positions WHERE position_id = ? AND user_id = ? AND status = 'open'")
    .get(positionId, userId) as PositionRow | undefined;
  if (!row) throw new DexError('NO_POSITION', 'no open position with that id', 404);
  return row;
}

/**
 * Apply a funding payment to every open position of a market.
 *
 * Longs pay shorts when the rate is positive. The payer's collateral is reduced
 * and the receiver's increased, both in the settlement asset, and the movement
 * is recorded so the funding history is auditable.
 */
export function applyFunding(symbol: string, rate: number): number {
  if (!Number.isFinite(rate)) throw new DexError('INVALID_RATE', 'funding rate must be finite', 400);
  const positions = getDb()
    .prepare("SELECT * FROM dex_perp_positions WHERE market = ? AND status = 'open'")
    .all(symbol.toUpperCase()) as PositionRow[];
  let total = 0;
  getDb().transaction(() => {
    for (const position of positions) {
      const mark = markPrice(position.market);
      const payment = fundingPayment(position.size, mark, rate);
      const side = position.side as PerpSide;
      // A positive rate means longs pay shorts.
      const signed = side === 'long' ? -payment : payment;
      const newMargin = position.collateral + signed;
      if (newMargin <= 0) {
        liquidatePosition(position.position_id, mark);
        continue;
      }
      getDb().prepare('UPDATE dex_perp_positions SET collateral = ? WHERE position_id = ?').run(newMargin, position.position_id);
      total += Math.abs(payment);
    }
  })();
  return total;
}

export interface LiquidationResult {
  positionId: string;
  penalty: number;
  liquidator: number;
  insurance: number;
}

/**
 * Liquidate a position that has fallen below its maintenance margin.
 *
 * The remaining collateral is charged the liquidation penalty; the liquidator
 * earns their share as a bounty and the rest tops up the insurance fund. The
 * position is marked closed with its realised loss.
 */
export function liquidatePosition(positionId: string, mark?: number): LiquidationResult {
  const position = getDb()
    .prepare("SELECT * FROM dex_perp_positions WHERE position_id = ? AND status = 'open'")
    .get(positionId) as PositionRow | undefined;
  if (!position) throw new DexError('NO_POSITION', 'no open position with that id', 404);
  const market = loadMarket(position.market);
  const markPriceNow = mark ?? markPrice(position.market);
  const side = position.side as PerpSide;

  const equity = position.collateral + unrealizedPnl(side, position.size, position.entry_price, markPriceNow);
  const penalty = Math.max(0, equity) * market.liquidation_fee_rate;
  const { liquidator, insurance } = liquidationPenaltySplit(penalty, 0.6);

  return getDb().transaction(() => {
    unlockAvailable(position.user_id, market.settlement_asset, position.collateral);
    // Only the collateral net of the penalty returns to the trader; a position
    // that has lost more than its margin returns nothing.
    const returned = Math.max(0, equity - penalty);
    if (returned > 0) creditAvailable(position.user_id, market.settlement_asset, returned);
    recordTransaction(position.user_id, 'dex_perp_liquidation', market.settlement_asset, returned, penalty, 'completed', `liquidate ${position.market}`);

    if (penalty > 0) {
      const parts = applySchedule(penalty, { lpBps: 0, vetgrBps: 0, treasuryBps: 10_000, insuranceBps: 0, burnBps: 0 });
      recordDexRevenue('dex_perp_liquidation', market.settlement_asset, penalty, parts, positionId);
    }

    getDb()
      .prepare("UPDATE dex_perp_positions SET status = 'liquidated', realized_pnl = ?, closed_at = datetime('now') WHERE position_id = ?")
      .run(equity - position.collateral, positionId);

    getDb()
      .prepare(
        `INSERT INTO insurance_funds (contract, balance, target_balance, fee_share)
         VALUES ('dex_perps', ?, ?, 0.1)
         ON CONFLICT(contract) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')`,
      )
      .run(insurance, dexSetting('dex_insurance_fund_target', 1_000_000), insurance);

    return { positionId, penalty, liquidator, insurance };
  })() as LiquidationResult;
}

/** Whether a position is liquidatable at the current mark. */
export function positionLiquidatable(position: PositionRow, mark: number): boolean {
  const market = loadMarket(position.market);
  return shouldLiquidate(
    position.side as PerpSide,
    position.size,
    position.entry_price,
    mark,
    position.collateral,
    market.maintenance_margin_rate,
  );
}

/** A user's open positions with live PnL. */
export function perpPositions(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare("SELECT * FROM dex_perp_positions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC")
    .all(userId) as PositionRow[];
  return rows.map((position) => {
    let mark = position.entry_price;
    try {
      mark = markPrice(position.market);
    } catch {
      mark = position.entry_price;
    }
    const pnl = unrealizedPnl(position.side as PerpSide, position.size, position.entry_price, mark);
    return {
      positionId: position.position_id,
      symbol: position.market,
      side: position.side,
      size: position.size,
      entryPrice: position.entry_price,
      markPrice: mark,
      leverage: position.leverage,
      margin: position.collateral,
      unrealizedPnl: pnl,
      equity: position.collateral + pnl,
      liquidationPrice: position.liquidation_price,
      marginMode: position.margin_mode,
    };
  });
}

export { oraclePriceImpact, borrowFee };
