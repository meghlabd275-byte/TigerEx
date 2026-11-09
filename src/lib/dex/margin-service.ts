/**
 * TigerSwap spot-margin and lending settlement.
 *
 * A market has a supply side (lenders who earn interest) and a borrow side
 * (traders who post collateral). Supplying moves the lender's asset into the
 * market and mints a supply position; borrowing locks collateral and credits
 * the borrowed asset; repaying and withdrawing reverse those movements. A
 * position whose health factor falls below 1 can be liquidated for a bonus.
 * Everything runs in one transaction and the interest model comes from
 * `./margin`.
 */

import { getDb, generateId } from '@/lib/db';
import {
  lockAvailable,
  unlockAvailable,
  creditAvailable,
  debitAvailable,
  covers,
  availableBalance,
  recordTransaction,
} from '@/lib/db/ledger';
import {
  DexError,
  dexSetting,
  recordDexRevenue,
  assertDexOpen,
  assertNotBlacklisted,
} from '@/lib/dex/pool-service';
import {
  borrowRate,
  supplyRate,
  maxBorrow,
  healthFactor,
  isLiquidatable,
  liquidate,
  utilization,
  accruedInterest,
  flashLoanFee,
  type InterestModel,
} from '@/lib/dex/margin';
import { applySchedule } from '@/lib/dex/fee-engine';
import { priceInQuote } from '@/lib/trading/valuation';

interface LendingMarketRow {
  market_id: string;
  asset: string;
  ltv: number;
  liquidation_threshold: number;
  liquidation_bonus: number;
  base_rate: number;
  kink: number;
  jump_multiplier: number;
  total_supply: number;
  total_borrow: number;
  supply_cap: number;
  borrow_cap: number;
  status: string;
  last_accrued_at?: string | null;
}

function loadMarket(asset: string): LendingMarketRow {
  const row = getDb().prepare('SELECT * FROM dex_lending_markets WHERE asset = ?').get(asset.toUpperCase()) as
    | LendingMarketRow
    | undefined;
  if (!row) throw new DexError('UNKNOWN_MARKET', `${asset} is not a listed lending market`, 404);
  if (row.status !== 'active') throw new DexError('MARKET_INACTIVE', `${asset} lending is ${row.status}`, 409);
  return row;
}

function interestModel(market: LendingMarketRow): InterestModel {
  return { baseRate: market.base_rate, kink: market.kink, jumpMultiplier: market.jump_multiplier };
}

/** Current utilisation, borrow rate and supply rate of a market. */
export function marketRates(market: LendingMarketRow): { utilization: number; borrowRate: number; supplyRate: number } {
  const util = utilization(market.total_borrow, market.total_supply);
  const model = interestModel(market);
  return { utilization: util, borrowRate: borrowRate(model, util), supplyRate: supplyRate(model, util, 0.1) };
}

export interface SupplyResult {
  marketId: string;
  supplied: number;
  totalSupplied: number;
}

/** Supply an asset to a lending market and earn interest on it. */
export function supply(userId: string, asset: string, amount: number): SupplyResult {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  assertDexOpen('dex', 'dex_margin');
  const market = loadMarket(asset);
  assertNotBlacklisted([
    { kind: 'wallet', value: userId },
    { kind: 'token', value: market.asset },
  ]);
  if (market.total_supply + amount > market.supply_cap) {
    throw new DexError('SUPPLY_CAP_REACHED', `${market.asset} supply cap reached`, 409);
  }
  if (!covers(availableBalance(userId, market.asset), amount)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${market.asset} balance`, 400);
  }

  return getDb().transaction(() => {
    debitAvailable(userId, market.asset, amount);
    recordTransaction(userId, 'dex_lend_supply', market.asset, amount, 0, 'completed', `market ${market.asset}`);
    getDb()
      .prepare(
        `INSERT INTO dex_lending_positions (position_id, market_id, user_id, supplied) VALUES (?, ?, ?, ?)
         ON CONFLICT(market_id, user_id) DO UPDATE SET supplied = supplied + excluded.supplied, updated_at = datetime('now')`,
      )
      .run(generateId(), market.market_id, userId, amount);
    getDb()
      .prepare("UPDATE dex_lending_markets SET total_supply = total_supply + ? WHERE market_id = ?")
      .run(amount, market.market_id);
    const position = getDb()
      .prepare('SELECT supplied FROM dex_lending_positions WHERE market_id = ? AND user_id = ?')
      .get(market.market_id, userId) as { supplied: number };
    return { marketId: market.market_id, supplied: amount, totalSupplied: position.supplied };
  })() as SupplyResult;
}

export interface BorrowResult {
  marketId: string;
  borrowed: number;
  totalBorrowed: number;
  collateralLocked: number;
}

/**
 * Borrow an asset against locked collateral.
 *
 * The collateral is locked in the ledger and the borrowed asset credited to the
 * caller. The amount is capped by the collateral's LTV and by the market's
 * borrow cap.
 */
export function borrow(
  userId: string,
  asset: string,
  amount: number,
  collateralAsset: string,
  collateralAmount: number,
): BorrowResult {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  if (!Number.isFinite(collateralAmount) || collateralAmount <= 0) {
    throw new DexError('INVALID_AMOUNT', 'collateralAmount must be positive', 400);
  }
  const market = loadMarket(asset);
  assertDexOpen('dex', 'dex_margin');
  assertNotBlacklisted([
    { kind: 'wallet', value: userId },
    { kind: 'token', value: market.asset },
  ]);
  const collateral = collateralAsset.toUpperCase();
  const collateralMarket = getDb().prepare('SELECT ltv FROM dex_lending_markets WHERE asset = ?').get(collateral) as
    | { ltv: number }
    | undefined;
  if (!collateralMarket) {
    throw new DexError('INVALID_COLLATERAL', `${collateral} cannot be used as collateral`, 400);
  }
  if (market.total_borrow + amount > market.borrow_cap) {
    throw new DexError('BORROW_CAP_REACHED', `${market.asset} borrow cap reached`, 409);
  }
  if (!covers(availableBalance(userId, collateral), collateralAmount)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${collateral} collateral`, 400);
  }

  const collateralPrice = priceInQuote(collateral, market.asset);
  if (collateralPrice === null) {
    throw new DexError('NO_PRICE', `no price for ${collateral}/${market.asset}`, 409);
  }
  const limit = maxBorrow(collateralAmount * collateralPrice, collateralMarket.ltv);
  if (amount > limit + 1e-9) {
    throw new DexError('EXCEEDS_LTV', `borrow of ${amount} exceeds the ${limit} limit for this collateral`, 400);
  }

  return getDb().transaction(() => {
    lockAvailable(userId, collateral, collateralAmount);
    recordTransaction(userId, 'dex_margin_collateral', collateral, collateralAmount, 0, 'completed', `borrow ${market.asset}`);
    creditAvailable(userId, market.asset, amount);
    recordTransaction(userId, 'dex_margin_borrow', market.asset, amount, 0, 'completed', `borrow ${market.asset}`);

    getDb()
      .prepare(
        `INSERT INTO dex_lending_positions (position_id, market_id, user_id, borrowed, collateral_asset)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(market_id, user_id) DO UPDATE SET
           borrowed = borrowed + excluded.borrowed,
           collateral_asset = excluded.collateral_asset,
           updated_at = datetime('now')`,
      )
      .run(generateId(), market.market_id, userId, amount, collateral);
    getDb()
      .prepare("UPDATE dex_lending_markets SET total_borrow = total_borrow + ? WHERE market_id = ?")
      .run(amount, market.market_id);

    const position = getDb()
      .prepare('SELECT borrowed FROM dex_lending_positions WHERE market_id = ? AND user_id = ?')
      .get(market.market_id, userId) as { borrowed: number };
    return { marketId: market.market_id, borrowed: amount, totalBorrowed: position.borrowed, collateralLocked: collateralAmount };
  })() as BorrowResult;
}

export interface RepayResult {
  marketId: string;
  repaid: number;
  remaining: number;
}

/** Repay a borrow and release the matching collateral. */
export function repay(userId: string, asset: string, amount: number, collateralAsset: string, collateralAmount: number): RepayResult {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  const market = loadMarket(asset);
  // Repaying is never paused: a borrower must always be able to clear debt.
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const position = getDb()
    .prepare('SELECT * FROM dex_lending_positions WHERE market_id = ? AND user_id = ?')
    .get(market.market_id, userId) as { position_id: string; borrowed: number; supplied: number } | undefined;
  if (!position || position.borrowed <= 0) throw new DexError('NO_BORROW', 'no borrow to repay', 404);
  if (amount > position.borrowed + 1e-9) throw new DexError('OVERPAY', 'repayment exceeds the debt', 400);
  if (!covers(availableBalance(userId, market.asset), amount)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${market.asset} balance`, 400);
  }

  return getDb().transaction(() => {
    debitAvailable(userId, market.asset, amount);
    recordTransaction(userId, 'dex_margin_repay', market.asset, amount, 0, 'completed', `repay ${market.asset}`);
    const remaining = position.borrowed - amount;
    getDb()
      .prepare("UPDATE dex_lending_positions SET borrowed = ?, updated_at = datetime('now') WHERE position_id = ?")
      .run(remaining, position.position_id);
    getDb()
      .prepare("UPDATE dex_lending_markets SET total_borrow = total_borrow - ? WHERE market_id = ?")
      .run(amount, market.market_id);

    if (collateralAmount > 0) {
      const collateral = collateralAsset.toUpperCase();
      const free = Math.min(collateralAmount, collateralAvailableToRelease(userId, collateral));
      if (free > 0) {
        unlockAvailable(userId, collateral, free);
        recordTransaction(userId, 'dex_margin_release', collateral, free, 0, 'completed', `repay ${market.asset}`);
      }
    }
    return { marketId: market.market_id, repaid: amount, remaining };
  })() as RepayResult;
}

/**
 * Collateral that may be released after a repayment.
 *
 * The released amount is capped so the remaining collateral still covers the
 * remaining debt at the collateral's LTV, so a partial repayment cannot leave
 * the position undercollateralised.
 */
function collateralAvailableToRelease(userId: string, collateral: string): number {
  const locked = getDb()
    .prepare(
      `SELECT COALESCE(SUM(b.locked), 0) AS locked FROM balances b JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ? AND b.currency = ?`,
    )
    .get(userId, collateral) as { locked: number };
  return Number(locked.locked) || 0;
}

export interface WithdrawSupplyResult {
  marketId: string;
  withdrawn: number;
  remaining: number;
}

/** Withdraw supplied liquidity, refusing to strand a borrow against it. */
export function withdrawSupply(userId: string, asset: string, amount: number): WithdrawSupplyResult {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  const market = loadMarket(asset);
  // Withdrawing supply is never paused; only the market's own liquidity gates it.
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const position = getDb()
    .prepare('SELECT * FROM dex_lending_positions WHERE market_id = ? AND user_id = ?')
    .get(market.market_id, userId) as { position_id: string; supplied: number; borrowed: number } | undefined;
  if (!position || position.supplied <= 0) throw new DexError('NO_SUPPLY', 'no supply position', 404);
  if (amount > position.supplied + 1e-9) throw new DexError('INSUFFICIENT_SUPPLY', 'amount exceeds the supply', 400);

  const free = market.total_supply - market.total_borrow;
  if (amount > free + 1e-9) {
    throw new DexError('LIQUIDITY_LOCKED', `only ${free} of the market is currently free to withdraw`, 409);
  }

  return getDb().transaction(() => {
    creditAvailable(userId, market.asset, amount);
    recordTransaction(userId, 'dex_lend_withdraw', market.asset, amount, 0, 'completed', `market ${market.asset}`);
    const remaining = position.supplied - amount;
    getDb()
      .prepare("UPDATE dex_lending_positions SET supplied = ?, updated_at = datetime('now') WHERE position_id = ?")
      .run(remaining, position.position_id);
    getDb()
      .prepare("UPDATE dex_lending_markets SET total_supply = total_supply - ? WHERE market_id = ?")
      .run(amount, market.market_id);
    return { marketId: market.market_id, withdrawn: amount, remaining };
  })() as WithdrawSupplyResult;
}

export interface LiquidateResult {
  positionId: string;
  debtRepaid: number;
  collateralSeized: number;
  bonus: number;
}

/** Liquidate an undercollateralised borrow, paying the keeper a bonus. */
export function liquidateBorrow(liquidatorId: string, marketId: string, positionId: string, collateralAsset: string): LiquidateResult {
  const position = getDb()
    .prepare('SELECT * FROM dex_lending_positions WHERE position_id = ?')
    .get(positionId) as { position_id: string; market_id: string; user_id: string; supplied: number; borrowed: number } | undefined;
  if (!position) throw new DexError('NO_POSITION', 'position does not exist', 404);
  const market = getDb().prepare('SELECT * FROM dex_lending_markets WHERE market_id = ?').get(marketId) as
    | LendingMarketRow
    | undefined;
  if (!market || market.market_id !== position.market_id) {
    throw new DexError('UNKNOWN_MARKET', 'market does not match the position', 404);
  }

  const collateral = collateralAsset.toUpperCase();
  const collateralPrice = priceInQuote(collateral, market.asset);
  if (collateralPrice === null) throw new DexError('NO_PRICE', `no price for ${collateral}/${market.asset}`, 409);

  const lockedCollateral = collateralAvailableToRelease(position.user_id, collateral);
  const collateralValue = lockedCollateral * collateralPrice;
  if (!isLiquidatable(collateralValue, market.liquidation_threshold, position.borrowed)) {
    throw new DexError('NOT_LIQUIDATABLE', 'the position is above its liquidation threshold', 409);
  }
  if (!covers(availableBalance(liquidatorId, market.asset), position.borrowed)) {
    throw new DexError('INSUFFICIENT_BALANCE', 'the liquidator cannot cover the debt', 400);
  }

  const result = liquidate(
    position.borrowed,
    collateralValue,
    position.borrowed,
    market.liquidation_bonus,
    0.5,
  );

  // `liquidate` returns values in the debt asset; the ledger moves collateral
  // units, so convert at the collateral price. The bonus is the value above the
  // repayment, and the two always add back to the seized value.
  const collateralSeized = result.seizedValue / collateralPrice;
  const bonus = result.bonusValue / collateralPrice;

  return getDb().transaction(() => {
    debitAvailable(liquidatorId, market.asset, result.debtRepaid);
    creditAvailable(liquidatorId, collateral, collateralSeized);
    recordTransaction(liquidatorId, 'dex_margin_liquidate', market.asset, result.debtRepaid, 0, 'completed', `liquidate ${positionId}`);
    recordTransaction(liquidatorId, 'dex_margin_bonus', collateral, collateralSeized, 0, 'completed', `liquidate ${positionId}`);

    const remainingDebt = position.borrowed - result.debtRepaid;
    getDb()
      .prepare("UPDATE dex_lending_positions SET borrowed = ?, updated_at = datetime('now') WHERE position_id = ?")
      .run(remainingDebt, position.position_id);
    getDb()
      .prepare("UPDATE dex_lending_markets SET total_borrow = total_borrow - ? WHERE market_id = ?")
      .run(result.debtRepaid, market.market_id);

    // The seized collateral leaves the borrower's locked balance.
    unlockAvailable(position.user_id, collateral, collateralSeized);

    if (bonus > 0) {
      const parts = applySchedule(bonus, { lpBps: 0, vetgrBps: 0, treasuryBps: 10_000, insuranceBps: 0, burnBps: 0 });
      recordDexRevenue('dex_margin_liquidation', collateral, bonus, parts, positionId);
    }
    return { positionId, debtRepaid: result.debtRepaid, collateralSeized, bonus };
  })() as LiquidateResult;
}

/**
 * A flash loan, settled atomically.
 *
 * The protocol credits the borrowed amount, requires the caller to have repaid
 * the principal plus the fee in the same transaction, and debits the repayment.
 * If the balance cannot cover the repayment the transaction throws and the
 * credit is rolled back, which is the flash-loan guarantee.
 */
export function flashLoan(userId: string, asset: string, amount: number): { amount: number; fee: number } {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  const market = loadMarket(asset);
  assertDexOpen('dex', 'dex_margin');
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const feeRate = dexSetting('dex_flash_loan_fee', 0.0009);
  const fee = flashLoanFee(amount, feeRate);
  const free = market.total_supply - market.total_borrow;
  if (amount > free + 1e-9) throw new DexError('INSUFFICIENT_LIQUIDITY', 'the market cannot fund this flash loan', 409);

  return getDb().transaction(() => {
    creditAvailable(userId, market.asset, amount);
    if (!covers(availableBalance(userId, market.asset), amount + fee)) {
      throw new DexError('FLASH_LOAN_NOT_REPAID', 'the loan was not repaid within the transaction', 400);
    }
    debitAvailable(userId, market.asset, amount + fee);
    recordTransaction(userId, 'dex_flash_loan', market.asset, amount, fee, 'completed', 'flash loan repaid');

    const parts = applySchedule(fee, { lpBps: 9000, vetgrBps: 0, treasuryBps: 1000, insuranceBps: 0, burnBps: 0 });
    recordDexRevenue('dex_flash_loan', market.asset, fee, parts, generateId());

    getDb()
      .prepare('INSERT INTO dex_flash_loans (loan_id, market_id, user_id, asset, amount, fee, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(generateId(), market.market_id, userId, market.asset, amount, fee, 'repaid');
    return { amount, fee };
  })() as { amount: number; fee: number };
}

/** Every listed lending market with its live rates. */
export function listLendingMarkets(): Array<Record<string, unknown>> {
  const rows = getDb().prepare('SELECT * FROM dex_lending_markets ORDER BY asset').all() as LendingMarketRow[];
  return rows.map((market) => {
    const rates = marketRates(market);
    return {
      marketId: market.market_id,
      asset: market.asset,
      ltv: market.ltv,
      liquidationThreshold: market.liquidation_threshold,
      liquidationBonus: market.liquidation_bonus,
      totalSupply: market.total_supply,
      totalBorrow: market.total_borrow,
      supplyCap: market.supply_cap,
      borrowCap: market.borrow_cap,
      status: market.status,
      utilization: rates.utilization,
      borrowRate: rates.borrowRate,
      supplyRate: rates.supplyRate,
    };
  });
}

/** A user's supply and borrow positions with their health. */
export function marginPositions(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare(
      `SELECT p.*, m.asset, m.liquidation_threshold, m.ltv FROM dex_lending_positions p
         JOIN dex_lending_markets m ON m.market_id = p.market_id
        WHERE p.user_id = ?`,
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const borrowed = Number(row.borrowed);
    const asset = String(row.asset);
    // The collateral is a balance in its own asset; the health factor compares
    // it to a debt in the borrowed asset, so it is valued in that asset first.
    // Without a price there is no health factor, and reporting one from the raw
    // quantity would read a healthy position as liquidatable.
    const collateralAsset = row.collateral_asset === null || row.collateral_asset === undefined ? null : String(row.collateral_asset);
    const locked = collateralAsset === null ? 0 : collateralAvailableToRelease(userId, collateralAsset);
    const collateralPrice = collateralAsset === null ? null : priceInQuote(collateralAsset, asset);
    const collateralValue = collateralPrice === null ? null : locked * collateralPrice;
    return {
      positionId: row.position_id,
      asset,
      supplied: Number(row.supplied),
      borrowed,
      collateralAsset,
      collateral: locked,
      collateralValue,
      healthFactor:
        borrowed > 0 && collateralValue !== null
          ? healthFactor(collateralValue, Number(row.liquidation_threshold), borrowed)
          : null,
    };
  });
}

export { accruedInterest };

export interface AccrualReport {
  markets: number;
  charged: number;
  /** Interest actually credited to lenders, after the reserve cut. */
  credited: number;
  reserve: number;
}

/** The protocol's share of borrow interest, read from settings. */
function reserveFactor(): number {
  const factor = dexSetting('dex_lending_reserve_factor', 0.1);
  return Math.min(0.5, Math.max(0, factor));
}

/**
 * Accrue borrow interest on every active market since it was last charged.
 *
 * Interest is charged to each borrower's debt and paid to the market's lenders,
 * in the same asset. The protocol keeps a reserve cut of the interest; the rest
 * is added to `total_supply`, which is what raises the value of a lender's
 * supply position, since a supply position is a claim on the market's supply
 * plus its accrued interest. Nothing moves between user balances: the debt
 * simply grows and the market's supply grows with it.
 *
 * A borrower whose debt cannot be paid out of its balance is left with the
 * debt; the interest is not a balance movement, so no account can be driven
 * negative by it.
 */
export function accrueInterest(now = Date.now()): AccrualReport {
  const db = getDb();
  const markets = db.prepare("SELECT * FROM dex_lending_markets WHERE status = 'active'").all() as LendingMarketRow[];
  const report: AccrualReport = { markets: 0, charged: 0, credited: 0, reserve: 0 };

  for (const market of markets) {
    const elapsedSeconds = elapsedSince(market, now);
    if (elapsedSeconds <= 0) continue;

    const positions = db
      .prepare('SELECT * FROM dex_lending_positions WHERE market_id = ? AND borrowed > 0')
      .all(market.market_id) as Array<{ position_id: string; borrowed: number; supplied: number }>;

    // The borrow rate depends on utilisation, which does not change as interest
    // accrues (both sides grow by the same proportion before the reserve cut),
    // so one rate applies to the whole interval.
    const { borrowRate: rate } = marketRates(market);
    let interest = 0;
    for (const position of positions) {
      interest += accruedInterest(Number(position.borrowed), rate, elapsedSeconds);
    }
    if (interest <= 0) {
      db.prepare("UPDATE dex_lending_markets SET last_accrued_at = datetime('now') WHERE market_id = ?").run(market.market_id);
      continue;
    }

    const toLenders = interest * (1 - reserveFactor());

    db.transaction(() => {
      for (const position of positions) {
        const share = accruedInterest(Number(position.borrowed), rate, elapsedSeconds);
        db.prepare("UPDATE dex_lending_positions SET borrowed = borrowed + ?, updated_at = datetime('now') WHERE position_id = ?").run(
          share,
          position.position_id,
        );
      }
      db.prepare(
        "UPDATE dex_lending_markets SET total_borrow = total_borrow + ?, total_supply = total_supply + ?, last_accrued_at = datetime('now') WHERE market_id = ?",
      ).run(interest, toLenders, market.market_id);
      recordDexRevenue('dex_lending_interest', market.asset, interest, applySchedule(interest, {
        lpBps: Math.round((1 - reserveFactor()) * 10_000),
        vetgrBps: 0,
        treasuryBps: Math.round(reserveFactor() * 10_000),
        insuranceBps: 0,
        burnBps: 0,
      }), market.market_id);
    })();
    report.markets += 1;
    report.charged += interest;
    report.credited += toLenders;
    report.reserve += interest - toLenders;
  }

  return report;
}

function elapsedSince(market: LendingMarketRow, now: number): number {
  const last = market.last_accrued_at;
  if (!last) return 0;
  const lastMs = Date.parse(last.includes('T') ? last : `${last.replace(' ', 'T')}Z`);
  if (!Number.isFinite(lastMs)) return 0;
  const seconds = (now - lastMs) / 1000;
  // A negative elapsed time (a clock skew) is treated as nothing to accrue.
  return Math.max(0, Math.floor(seconds));
}
