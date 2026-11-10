/**
 * TigerSwap options AMM settlement.
 *
 * A pool holds settlement collateral and writes cash-settled options against
 * one underlying. Buying locks the buyer's premium and reserves the contract's
 * worst-case payout out of the pool's collateral; settlement pays the holder the
 * capped intrinsic value out of that reserved collateral and releases the rest.
 * The pool is the counterparty, so every write is checked against the free
 * collateral and fails closed when the reserve cannot be met.
 *
 * Everything runs in one SQLite transaction, and the pricing comes from
 * `./options`.
 */

import { getDb, generateId } from '@/lib/db';
import { debitAvailable, creditAvailable, covers, availableBalance, recordTransaction } from '@/lib/db/ledger';
import { DexError, dexSetting, recordDexRevenue, assertDexOpen, assertNotBlacklisted } from '@/lib/dex/pool-service';
import { applySchedule } from '@/lib/dex/fee-engine';
import { markPrice } from '@/lib/dex/perps-service';
import { priceInQuote } from '@/lib/trading/valuation';
import { OPTION_TYPES, buyQuote, optionPremium, settlementPayout, writerYield, type OptionType } from '@/lib/dex/options';

interface OptionPoolRow {
  pool_id: string;
  underlying: string;
  settlement_asset: string;
  collateral: number;
  reserved: number;
  fee_bps: number;
  volatility: number;
  risk_free_rate: number;
  status: string;
}

interface OptionPositionRow {
  position_id: string;
  pool_id: string;
  user_id: string;
  underlying: string;
  option_type: string;
  strike: number;
  cap_price: number;
  contract_size: number;
  quantity: number;
  premium: number;
  fee: number;
  reserved: number;
  max_payout: number;
  status: string;
  opened_at: string;
  settled_at: string | null;
  settlement_price: number | null;
  payout: number | null;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function loadPool(poolId: string): OptionPoolRow {
  const row = getDb().prepare('SELECT * FROM dex_option_pools WHERE pool_id = ?').get(poolId) as OptionPoolRow | undefined;
  if (!row) throw new DexError('UNKNOWN_POOL', `option pool ${poolId} does not exist`, 404);
  return row;
}

/** The spot of an underlying, in the pool's settlement asset. */
function spotOf(underlying: string, settlement: string): number {
  if (underlying.toUpperCase() === settlement.toUpperCase()) return 1;
  const value = priceInQuote(underlying.toUpperCase(), settlement.toUpperCase());
  if (value === null || !Number.isFinite(value) || value <= 0) {
    // Fall back to the perpetual mark, which the venue keeps for every listed
    // underlying, so a pool can price even when no spot valuation is stored.
    return markPrice(`${underlying.toUpperCase()}/${settlement.toUpperCase()}`);
  }
  return value;
}

export interface CreateOptionPoolRequest {
  underlying: string;
  settlementAsset: string;
  volatility: number;
  riskFreeRate?: number;
  feeBps?: number;
  /** Seed collateral, moved from the treasury by an administrator. */
  collateral?: number;
}

/** Create an options pool for one underlying. */
export function createOptionPool(request: CreateOptionPoolRequest): OptionPoolRow {
  const underlying = String(request.underlying ?? '').trim().toUpperCase();
  const settlement = String(request.settlementAsset ?? '').trim().toUpperCase();
  if (!underlying) throw new DexError('VALIDATION_FAILED', 'underlying is required', 400);
  if (!settlement) throw new DexError('VALIDATION_FAILED', 'settlementAsset is required', 400);
  const volatility = Number(request.volatility);
  if (!Number.isFinite(volatility) || volatility <= 0 || volatility > 10) {
    throw new DexError('INVALID_VOLATILITY', 'volatility must be a positive fraction no greater than 10', 400);
  }
  const riskFreeRate = Number(request.riskFreeRate ?? 0);
  if (!Number.isFinite(riskFreeRate) || riskFreeRate < 0) {
    throw new DexError('INVALID_RATE', 'riskFreeRate must be a non-negative fraction', 400);
  }
  const feeBps = Number(request.feeBps ?? 50);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) {
    throw new DexError('INVALID_FEE', 'feeBps must be an integer in [0, 10000)', 400);
  }
  const collateral = Number(request.collateral ?? 0);
  if (!Number.isFinite(collateral) || collateral < 0) {
    throw new DexError('INVALID_AMOUNT', 'collateral must be non-negative', 400);
  }

  const poolId = generateId();
  getDb()
    .prepare(
      `INSERT INTO dex_option_pools
         (pool_id, underlying, settlement_asset, collateral, reserved, fee_bps, volatility, risk_free_rate, status)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'active')`,
    )
    .run(poolId, underlying, settlement, collateral, feeBps, volatility, riskFreeRate);
  return loadPool(poolId);
}

/** Every option pool with its free collateral. */
export function listOptionPools(): Array<Record<string, unknown>> {
  const rows = getDb().prepare('SELECT * FROM dex_option_pools ORDER BY created_at DESC').all() as OptionPoolRow[];
  return rows.map((row) => ({
    poolId: row.pool_id,
    underlying: row.underlying,
    settlementAsset: row.settlement_asset,
    collateral: row.collateral,
    reserved: row.reserved,
    freeCollateral: Math.max(0, row.collateral - row.reserved),
    feeBps: row.fee_bps,
    volatility: row.volatility,
    riskFreeRate: row.risk_free_rate,
    status: row.status,
  }));
}

/** Move treasury collateral into a pool so it can write more options. */
export function fundOptionPool(poolId: string, amount: number): OptionPoolRow {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  const pool = loadPool(poolId);
  getDb()
    .prepare("UPDATE dex_option_pools SET collateral = collateral + ?, updated_at = datetime('now') WHERE pool_id = ?")
    .run(amount, pool.pool_id);
  return loadPool(poolId);
}

export interface BuyOptionRequest {
  userId: string;
  poolId: string;
  type: OptionType;
  strike: number;
  /** Payout cap for a call; ignored for a put. */
  capPrice?: number;
  quantity: number;
  /** ISO timestamp; defaults to one month out when omitted. */
  expiry?: string;
}

export interface BuyOptionResult {
  positionId: string;
  poolId: string;
  type: OptionType;
  strike: number;
  capPrice: number;
  quantity: number;
  premium: number;
  fee: number;
  totalCost: number;
  reserved: number;
  maxPayout: number;
  spot: number;
  delta: number;
  impliedYield: number;
}

/**
 * Buy an option from a pool.
 *
 * The buyer pays the premium plus the pool's fee from available balance; the
 * pool reserves the contract's worst-case payout out of its collateral. A trade
 * the pool cannot back is refused, and a pool that is not active cannot be
 * traded.
 */
export function buyOption(request: BuyOptionRequest): BuyOptionResult {
  assertDexOpen('dex', 'dex_options');
  if (!(OPTION_TYPES as readonly string[]).includes(request.type)) {
    throw new DexError('INVALID_TYPE', `type must be one of ${OPTION_TYPES.join(', ')}`, 400);
  }
  const pool = loadPool(request.poolId);
  if (pool.status !== 'active') throw new DexError('POOL_INACTIVE', `option pool is ${pool.status}`, 409);
  assertNotBlacklisted([
    { kind: 'wallet', value: request.userId },
    { kind: 'token', value: pool.settlement_asset },
  ]);

  const strike = Number(request.strike);
  if (!Number.isFinite(strike) || strike <= 0) throw new DexError('INVALID_STRIKE', 'strike must be positive', 400);
  const quantity = Number(request.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new DexError('INVALID_AMOUNT', 'quantity must be positive', 400);

  const spot = spotOf(pool.underlying, pool.settlement_asset);
  // A call needs a cap above the strike; default it 50% above the strike so the
  // pool's worst-case liability is bounded and reservable.
  const capPrice = request.type === 'call' ? Number(request.capPrice ?? strike * 1.5) : strike;
  if (request.type === 'call' && (!Number.isFinite(capPrice) || capPrice <= strike)) {
    throw new DexError('INVALID_CAP', 'capPrice must exceed the strike for a call', 400);
  }

  const expiryMs = request.expiry ? Date.parse(request.expiry) : Date.now() + 30 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(expiryMs)) throw new DexError('INVALID_EXPIRY', 'expiry must be a valid date', 400);
  const timeToExpiry = Math.max(0, (expiryMs - Date.now()) / YEAR_MS);
  if (timeToExpiry <= 0) throw new DexError('INVALID_EXPIRY', 'expiry must be in the future', 400);

  const contractSize = 1;
  const feeRate = pool.fee_bps / 10_000;
  const free = Math.max(0, pool.collateral - pool.reserved);

  const quote = buyQuote({
    type: request.type,
    spot,
    strike,
    capPrice,
    timeToExpiry,
    volatility: pool.volatility,
    riskFreeRate: pool.risk_free_rate,
    contractSize,
    quantity,
    feeRate,
    freeCollateral: free,
  });

  const settlement = pool.settlement_asset;
  if (!covers(availableBalance(request.userId, settlement), quote.totalCost)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${settlement} balance for the premium`, 400);
  }

  const positionId = generateId();
  return getDb().transaction(() => {
    // The premium and fee leave the buyer and become pool collateral, so the
    // pool's ability to pay grows with what it writes.
    debitAvailable(request.userId, settlement, quote.totalCost);
    recordTransaction(request.userId, 'dex_option_buy', settlement, quote.premium, quote.fee, 'completed', `option ${positionId}`);

    getDb()
      .prepare(
        "UPDATE dex_option_pools SET collateral = collateral + ?, reserved = reserved + ?, updated_at = datetime('now') WHERE pool_id = ?",
      )
      .run(quote.totalCost, quote.reserve, pool.pool_id);

    const parts = applySchedule(quote.fee, dexFeeSplit());
    recordDexRevenue('dex_option_fee', settlement, quote.fee, parts, positionId);

    getDb()
      .prepare(
        `INSERT INTO dex_option_positions
           (position_id, pool_id, user_id, underlying, option_type, strike, cap_price, contract_size,
            quantity, premium, fee, reserved, max_payout, status, settlement_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        positionId,
        pool.pool_id,
        request.userId,
        pool.underlying,
        request.type,
        strike,
        capPrice,
        contractSize,
        quantity,
        quote.premium,
        quote.fee,
        quote.reserve,
        quote.maxPayout,
        spot,
      );

    const priced = optionPremium({
      type: request.type,
      spot,
      strike,
      timeToExpiry,
      volatility: pool.volatility,
      riskFreeRate: pool.risk_free_rate,
      contractSize,
      quantity,
    });

    return {
      positionId,
      poolId: pool.pool_id,
      type: request.type,
      strike,
      capPrice,
      quantity,
      premium: quote.premium,
      fee: quote.fee,
      totalCost: quote.totalCost,
      reserved: quote.reserve,
      maxPayout: quote.maxPayout,
      spot,
      delta: priced.delta,
      impliedYield: writerYield(quote.premium, quote.reserve, timeToExpiry),
    };
  })() as BuyOptionResult;
}

/** The fee split for option fees, read from settings so an operator can tune it. */
function dexFeeSplit() {
  return {
    lpBps: dexSetting('dex_option_fee_split_lp_bps', 0),
    vetgrBps: dexSetting('dex_option_fee_split_vetgr_bps', 4000),
    treasuryBps: dexSetting('dex_option_fee_split_treasury_bps', 5000),
    insuranceBps: dexSetting('dex_option_fee_split_insurance_bps', 1000),
    burnBps: dexSetting('dex_option_fee_split_burn_bps', 0),
  };
}

export interface SettleOptionResult {
  positionId: string;
  settlementPrice: number;
  payout: number;
  released: number;
}

/**
 * Settle an open option at the current spot.
 *
 * The pool pays the holder the capped intrinsic value out of the reserved
 * collateral and releases the rest of the reservation back to free collateral.
 * The payout is bounded by the reserve the pool set aside when the contract was
 * written, so a settlement can never overdraw the pool.
 */
export function settleOption(userId: string, positionId: string): SettleOptionResult {
  const position = getDb()
    .prepare("SELECT * FROM dex_option_positions WHERE position_id = ? AND user_id = ? AND status = 'open'")
    .get(positionId, userId) as OptionPositionRow | undefined;
  if (!position) throw new DexError('NO_POSITION', 'no open option with that id', 404);
  const pool = loadPool(position.pool_id);
  const settlementPrice = spotOf(pool.underlying, pool.settlement_asset);

  const payout = settlementPayout(
    position.option_type as OptionType,
    position.strike,
    settlementPrice,
    position.contract_size,
    position.max_payout,
  );
  const reserved = Number(position.reserved);
  if (payout > reserved + 1e-9) {
    // Cannot happen while the reserve is the cap, but fail closed if the row
    // was tampered with rather than paying out more than was set aside.
    throw new DexError('RESERVE_EXCEEDED', 'payout exceeds the reserved collateral', 409);
  }

  return getDb().transaction(() => {
    if (payout > 0) creditAvailable(userId, pool.settlement_asset, payout);
    recordTransaction(userId, 'dex_option_settle', pool.settlement_asset, payout, 0, 'completed', `option ${positionId}`);

    // The payout leaves the pool's collateral; the unused reservation becomes
    // free again. A payout is always inside the reserve, so collateral stays
    // non-negative.
    getDb()
      .prepare(
        `UPDATE dex_option_pools
            SET collateral = collateral - ?, reserved = reserved - ?, updated_at = datetime('now')
          WHERE pool_id = ?`,
      )
      .run(payout, reserved, pool.pool_id);

    getDb()
      .prepare(
        `UPDATE dex_option_positions
            SET status = 'settled', settled_at = datetime('now'), settlement_price = ?, payout = ?
          WHERE position_id = ?`,
      )
      .run(settlementPrice, payout, positionId);

    return { positionId, settlementPrice, payout, released: reserved - payout };
  })() as SettleOptionResult;
}

/** A user's option positions, newest first. */
export function optionPositions(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare('SELECT * FROM dex_option_positions WHERE user_id = ? ORDER BY opened_at DESC LIMIT 200')
    .all(userId) as OptionPositionRow[];
  return rows.map((row) => ({
    positionId: row.position_id,
    poolId: row.pool_id,
    underlying: row.underlying,
    type: row.option_type,
    strike: row.strike,
    capPrice: row.cap_price,
    quantity: row.quantity,
    premium: row.premium,
    fee: row.fee,
    reserved: row.reserved,
    maxPayout: row.max_payout,
    status: row.status,
    openedAt: row.opened_at,
    settledAt: row.settled_at,
    settlementPrice: row.settlement_price,
    payout: row.payout,
  }));
}

export { optionPremium, settlementPayout, writerYield };
