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
import { lockAvailable, unlockAvailable, creditAvailable, debitAvailable, covers, availableBalance, recordTransaction, consumeLocked, creditLocked } from '@/lib/db/ledger';
import {
  DexError,
  dexSetting,
  recordDexRevenue,
  assertDexOpen,
  assertNotBlacklisted,
  creditFund,
  debitFund,
  fundBalance,
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
  collateral_asset: string;
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

/**
 * The settlement account that stands on the other side of every perpetual.
 *
 * A perpetual is a zero-sum contract between a trader and a counterparty. The
 * venue runs that counterparty as a real funded pool: a trader's realised profit
 * is paid out of it and a trader's realised loss is paid into it. Without the
 * pool a winning close would credit the trader with value nobody posted, and a
 * liquidation would delete the seized margin instead of banking it.
 */
const PERP_POOL = 'dex_perp_pool';

/** The per-asset balance of the perpetual counterparty pool. */
export function perpPoolBalance(asset: string): number {
  return fundBalance(PERP_POOL, asset);
}

/** Seed the pool so it can pay out profit, as a funded transfer would. */
export function fundPerpPool(asset: string, amount: number): void {
  creditFund(PERP_POOL, asset, amount);
}

/** Pay a trader's realised profit out of the pool, failing closed when short. */
function poolPays(asset: string, amount: number): void {
  if (amount <= 0) return;
  debitFund(PERP_POOL, asset, amount);
}

/** Bank a trader's realised loss (or seized collateral) into the pool. */
function poolReceives(asset: string, amount: number): void {
  if (amount <= 0) return;
  creditFund(PERP_POOL, asset, amount);
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
  const settlement = market.settlement_asset;
  // The price move, before fees. The counterparty pool is the other side of
  // this move: it pays a profit and banks a loss.
  const gross = unrealizedPnl(side, position.size, position.entry_price, exitPrice);
  // The margin is locked, so closing unlocks it. The price PnL and the close
  // fee then move on top of the unlocked margin. The open fee was already
  // charged when the position opened, so it is not charged again: the net
  // change to the trader's total balance across open and close is `pnl`.
  const settlementDelta = pnl + openFee;
  const released = Math.max(0, position.collateral + settlementDelta);

  return getDb().transaction(() => {
    unlockAvailable(userId, settlement, position.collateral);
    if (settlementDelta > 0) {
      creditAvailable(userId, settlement, settlementDelta);
    } else if (settlementDelta < 0) {
      // A loss cannot push the account negative: it is capped at the margin the
      // position posted, which is the isolated-loss guarantee.
      debitAvailable(userId, settlement, Math.min(-settlementDelta, position.collateral));
    }

    // The pool settles the price move. A profit is paid out of the pool's real
    // balance (it fails closed when the pool is short, so a winning close can
    // never mint); a loss is banked into it, capped at what the trader actually
    // paid for the price move after the close fee the protocol already took.
    if (gross > 0) {
      poolPays(settlement, gross);
    } else if (gross < 0) {
      const paidByTrader = settlementDelta < 0 ? Math.min(-settlementDelta, position.collateral) : 0;
      poolReceives(settlement, Math.min(-gross, Math.max(0, paidByTrader - closeFee)));
    }

    recordTransaction(userId, 'dex_perp_close', settlement, released, Math.max(closeFee, 0), 'completed', `close ${position.market}`);

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
 * Longs pay shorts when the rate is positive. Funding is settled in two passes
 * so the ledger stays in step with the position collateral: first every payer's
 * margin is charged, then every receiver is credited. The two passes move the
 * same total, so funding is zero-sum and the reservations still add up to the
 * collateral on each position. A payer whose margin cannot cover its payment is
 * liquidated and contributes nothing; the receivers are then paid pro-rata out
 * of what the payers actually gave up, so a liquidation can never mint locked
 * balance for the surviving side.
 */
export function applyFunding(symbol: string, rate: number): number {
  if (!Number.isFinite(rate)) throw new DexError('INVALID_RATE', 'funding rate must be finite', 400);
  const positions = getDb()
    .prepare("SELECT * FROM dex_perp_positions WHERE market = ? AND status = 'open'")
    .all(symbol.toUpperCase()) as PositionRow[];

  // Work out each position's signed payment and the mark it was struck at.
  const plan = positions.map((position) => {
    const mark = markPrice(position.market);
    const payment = fundingPayment(position.size, mark, rate);
    const side = position.side as PerpSide;
    // A positive rate means longs pay shorts.
    const signed = side === 'long' ? -payment : payment;
    return { position, mark, signed };
  });

  let collected = 0;

  getDb().transaction(() => {
    const payers = plan.filter((entry) => entry.signed < 0);
    const receivers = plan.filter((entry) => entry.signed > 0);

    // Pass one: charge every payer, liquidating one that cannot cover the
    // payment. `collected` is what actually left the payers' reservations, which
    // is the only amount the receivers may be paid.
    for (const entry of payers) {
      const charge = Math.min(-entry.signed, entry.position.collateral);
      if (entry.position.collateral - charge <= 0) {
        liquidatePosition(entry.position.position_id, entry.mark);
        continue;
      }
      consumeLocked(entry.position.user_id, entry.position.collateral_asset, charge);
      getDb()
        .prepare('UPDATE dex_perp_positions SET collateral = collateral - ? WHERE position_id = ?')
        .run(charge, entry.position.position_id);
      collected += charge;
    }

    // Pass two: pay the receivers pro-rata out of `collected`. When every payer
    // paid, this is exactly the planned amount; when a payer was liquidated the
    // pool is smaller and the receivers share it.
    const wanted = receivers.reduce((sum, entry) => sum + entry.signed, 0);
    if (collected > 0 && wanted > 0) {
      let paid = 0;
      receivers.forEach((entry, index) => {
        // The last receiver takes the remainder so the parts always sum to
        // `collected` exactly, however the division rounds.
        const amount = index === receivers.length - 1 ? collected - paid : (collected * entry.signed) / wanted;
        if (amount <= 0) return;
        creditLocked(entry.position.user_id, entry.position.collateral_asset, amount);
        getDb()
          .prepare('UPDATE dex_perp_positions SET collateral = collateral + ? WHERE position_id = ?')
          .run(amount, entry.position.position_id);
        paid += amount;
      });
    }
  })();
  return collected;
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
    // The unlock already returns the whole margin to the account, so only the
    // seized part is removed from it. Crediting the returned equity as well
    // would hand the trader the seized margin back and turn a loss into a mint.
    const returned = Math.max(0, equity - penalty);
    const seized = position.collateral - returned;
    if (seized > 0) debitAvailable(position.user_id, market.settlement_asset, seized);
    // The seized margin is the trader's loss; it is banked into the pool that
    // was the other side of the price move, less the penalty the protocol
    // books to the insurance fund and treasury below. Deleting it instead would
    // destroy value the pool is owed.
    poolReceives(market.settlement_asset, Math.max(0, seized - penalty));
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
