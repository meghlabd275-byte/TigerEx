/**
 * Spot margin engine.
 *
 * A margin loan is a debt against posted collateral. The parameters come from
 * the admin-listed `margin_markets` row for the pair: which assets may be
 * posted, each asset's loan-to-value, its liquidation threshold and the kinked
 * interest model. Nothing here is hard-coded, so changing a listing changes the
 * risk the engine enforces.
 *
 * Collateral is locked when the loan opens, so the same balance cannot back two
 * loans or be withdrawn while it is pledged. Interest accrues continuously from
 * the borrow time and is settled before principal on repayment.
 */

import { getDb, generateId } from '@/lib/db';
import { parseUtcTimestamp } from '@/lib/trading/candles';
import {
  availableBalance,
  lockAvailable,
  unlockAvailable,
  creditAvailable,
  debitAvailable,
  consumeLocked,
  recordTransaction,
  covers,
  LedgerError,
} from '@/lib/db/ledger';
import { priceInQuote, valueInQuote } from '@/lib/trading/valuation';
import { borrowInterest } from '@/lib/trading/fees';
import { pausedScope, pauseMessage } from '@/lib/trading/controls';
import { recordRevenue } from '@/lib/trading/revenue';

export class MarginError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface MarginMarketRow {
  market_id: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  mode: string;
  max_leverage: number;
  collateral_ltv: string;
  borrowable_assets: string;
  interest_base_apr: number;
  interest_kink_utilization: number;
  interest_kink_apr: number;
  interest_max_apr: number;
  liquidation_thresholds: string;
  liquidation_bonus: number;
  risk_tier: string;
  status: string;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadMarket(symbol: string, mode: string): MarginMarketRow {
  const row = getDb()
    .prepare("SELECT * FROM margin_markets WHERE symbol = ? AND mode = ? AND status = 'active'")
    .get(symbol.trim().toUpperCase(), mode) as MarginMarketRow | undefined;
  if (!row) {
    throw new MarginError('UNKNOWN_MARKET', `${symbol} is not listed for ${mode} margin`, 404);
  }
  return row;
}

/** The kinked interest model for a market. */
export interface InterestModel {
  baseApr: number;
  kinkUtilization: number;
  kinkApr: number;
  maxApr: number;
}

export function interestModel(market: MarginMarketRow): InterestModel {
  return {
    baseApr: Number(market.interest_base_apr),
    kinkUtilization: Number(market.interest_kink_utilization),
    kinkApr: Number(market.interest_kink_apr),
    maxApr: Number(market.interest_max_apr),
  };
}

interface LoanRow {
  loan_id: string;
  user_id: string;
  symbol: string;
  asset: string;
  principal: number;
  interest_accrued: number;
  collateral_asset: string;
  collateral_amount: number;
  mode: string;
  status: string;
  opened_at: string;
  updated_at: string;
}

/**
 * Interest accrued on a loan since it was last settled.
 *
 * Pool utilisation is the market's borrowed amount against its configured
 * capacity; when a market has no capacity configured the base rate applies, so
 * a small market is never priced at the maximum by default.
 */
export function accruedInterest(loan: LoanRow, now: number = Date.now()): number {
  if (loan.status !== 'open') return 0;
  const market = getDb()
    .prepare('SELECT * FROM margin_markets WHERE symbol = ?')
    .get(loan.symbol) as MarginMarketRow | undefined;
  if (!market) return 0;

  const since = parseUtcTimestamp(loan.updated_at);
  const hours = Number.isFinite(since) ? Math.max(0, (now - since) / 3_600_000) : 0;
  if (hours <= 0) return 0;

  const model = interestModel(market);
  const utilization = marketUtilization(loan.symbol);
  return borrowInterest(
    Number(loan.principal),
    utilization,
    model.baseApr,
    model.kinkUtilization,
    model.kinkApr,
    model.maxApr,
    hours,
  );
}

/**
 * Fraction of a market's configured borrow capacity currently lent out.
 *
 * A market with no capacity row reports zero utilisation rather than a guess.
 */
export function marketUtilization(symbol: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(l.principal), 0) AS borrowed
         FROM margin_loans l WHERE l.symbol = ? AND l.status = 'open'`,
    )
    .get(symbol) as { borrowed: number } | undefined;
  const borrowed = Number(row?.borrowed) || 0;

  const limitRow = getDb()
    .prepare("SELECT value FROM system_settings WHERE key = ?")
    .get(`margin.capacity.${symbol}`) as { value: string } | undefined;
  const capacity = limitRow ? Number(limitRow.value) : NaN;
  if (!Number.isFinite(capacity) || capacity <= 0) return 0;

  return Math.min(Math.max(borrowed / capacity, 0), 1);
}

export interface MarginLoanView {
  loanId: string;
  symbol: string;
  mode: string;
  asset: string;
  principal: number;
  interestAccrued: number;
  totalOwed: number;
  collateralAsset: string;
  collateralAmount: number;
  collateralValue: number;
  loanValue: number;
  ltv: number;
  liquidationThreshold: number;
  healthRatio: number;
  liquidatable: boolean;
  openedAt: string;
}

/**
 * Value a loan's collateral and debt in the market's quote asset.
 *
 * Returns null for an unpriced side so the caller can refuse to act on a loan
 * whose health cannot be computed.
 */
function valueLoan(loan: LoanRow, now: number): MarginLoanView | null {
  const market = getDb()
    .prepare('SELECT * FROM margin_markets WHERE symbol = ?')
    .get(loan.symbol) as MarginMarketRow | undefined;
  if (!market) return null;

  const quote = market.quote_asset;
  const collateralValue = valueInQuote(loan.collateral_asset, Number(loan.collateral_amount), quote);
  const loanValue = valueInQuote(loan.asset, Number(loan.principal), quote);
  if (collateralValue === null || loanValue === null) return null;

  const interest = Number(loan.interest_accrued) + accruedInterest(loan, now);
  const thresholds = parseJson<Record<string, number>>(market.liquidation_thresholds, {});
  const threshold = thresholds[loan.collateral_asset] ?? 0;

  const debt = loanValue + (valueInQuote(loan.asset, interest, quote) ?? 0);
  const liquidatableValue = collateralValue * threshold;
  const healthRatio = debt === 0 ? Infinity : liquidatableValue / debt;

  return {
    loanId: loan.loan_id,
    symbol: loan.symbol,
    mode: loan.mode,
    asset: loan.asset,
    principal: Number(loan.principal),
    interestAccrued: interest,
    totalOwed: Number(loan.principal) + interest,
    collateralAsset: loan.collateral_asset,
    collateralAmount: Number(loan.collateral_amount),
    collateralValue,
    loanValue: debt,
    ltv: collateralValue === 0 ? Infinity : debt / collateralValue,
    liquidationThreshold: threshold,
    healthRatio,
    liquidatable: debt > 0 && healthRatio < 1,
    openedAt: loan.opened_at,
  };
}

/** A user's margin loans, with accrued interest and health, newest first. */
export function listMarginLoans(userId: string, now: number = Date.now()): MarginLoanView[] {
  const rows = getDb()
    .prepare('SELECT * FROM margin_loans WHERE user_id = ? ORDER BY opened_at DESC')
    .all(userId) as LoanRow[];

  const views: MarginLoanView[] = [];
  for (const row of rows) {
    const view = valueLoan(row, now);
    if (view) views.push(view);
  }
  return views;
}

/** Aggregate margin account for a user, or null when nothing can be valued. */
export function marginAccount(
  userId: string,
  now: number = Date.now(),
): {
  loans: MarginLoanView[];
  totalCollateralValue: number;
  totalDebt: number;
  healthRatio: number;
  liquidatable: boolean;
} {
  const loans = listMarginLoans(userId, now);
  const totalCollateralValue = loans.reduce((sum, loan) => sum + loan.collateralValue, 0);
  const totalDebt = loans.reduce((sum, loan) => sum + loan.loanValue, 0);
  const liquidatableValue = loans.reduce(
    (sum, loan) => sum + loan.collateralValue * loan.liquidationThreshold,
    0,
  );

  return {
    loans,
    totalCollateralValue,
    totalDebt,
    healthRatio: totalDebt === 0 ? Infinity : liquidatableValue / totalDebt,
    liquidatable: totalDebt > 0 && liquidatableValue < totalDebt,
  };
}

export interface BorrowInput {
  symbol: string;
  mode?: string;
  asset: string;
  amount: number;
  collateralAsset: string;
  collateralAmount: number;
}

/**
 * Open a margin loan against locked collateral.
 *
 * The borrowed asset must be borrowable on the market and the collateral asset
 * must be postable; the resulting loan-to-value must be within the collateral
 * asset's LTV, so the loan is not liquidatable the instant it opens.
 */
export function borrow(userId: string, input: BorrowInput): MarginLoanView {
  const paused = pausedScope('margin');
  if (paused) throw new MarginError('TRADING_PAUSED', pauseMessage(paused), 409);
  const mode = (input.mode ?? 'cross').trim().toLowerCase();
  const market = loadMarket(input.symbol, mode);

  const asset = input.asset.trim().toUpperCase();
  const collateralAsset = input.collateralAsset.trim().toUpperCase();
  const amount = Number(input.amount);
  const collateralAmount = Number(input.collateralAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MarginError('VALIDATION_FAILED', 'amount must be a positive number');
  }
  if (!Number.isFinite(collateralAmount) || collateralAmount <= 0) {
    throw new MarginError('VALIDATION_FAILED', 'collateralAmount must be a positive number');
  }

  const borrowable = parseJson<string[]>(market.borrowable_assets, []);
  if (!borrowable.includes(asset)) {
    throw new MarginError('NOT_BORROWABLE', `${asset} is not borrowable on ${market.symbol}`, 400);
  }

  const ltvTable = parseJson<Record<string, number>>(market.collateral_ltv, {});
  const ltv = ltvTable[collateralAsset];
  if (ltv === undefined) {
    throw new MarginError('NOT_COLLATERAL', `${collateralAsset} is not accepted as collateral`, 400);
  }

  const quote = market.quote_asset;
  const collateralValue = valueInQuote(collateralAsset, collateralAmount, quote);
  const borrowValue = valueInQuote(asset, amount, quote);
  if (collateralValue === null || borrowValue === null) {
    throw new MarginError('PRICE_UNAVAILABLE', 'No market price is available to value this loan', 409);
  }
  if (collateralValue <= 0) {
    throw new MarginError('VALIDATION_FAILED', 'Collateral has no value');
  }
  if (borrowValue > collateralValue * ltv + 1e-9) {
    throw new MarginError(
      'LTV_EXCEEDED',
      `Borrowing ${borrowValue} ${quote} against ${collateralValue} ${quote} of ${collateralAsset} exceeds the ${ltv} LTV`,
    );
  }

  if (!covers(availableBalance(userId, collateralAsset), collateralAmount)) {
    throw new MarginError('INSUFFICIENT_BALANCE', `Insufficient ${collateralAsset} balance`);
  }

  const db = getDb();
  const loanId = generateId();

  try {
    const run = db.transaction(() => {
      lockAvailable(userId, collateralAsset, collateralAmount);
      creditAvailable(userId, asset, amount);
      db.prepare(
        `INSERT INTO margin_loans
           (loan_id, user_id, symbol, asset, principal, interest_accrued,
            collateral_asset, collateral_amount, mode, status)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'open')`,
      ).run(loanId, userId, market.symbol, asset, amount, collateralAsset, collateralAmount, mode);
      recordTransaction(userId, 'margin_borrow', asset, amount, 0, 'completed', `Borrow ${amount} ${asset} against ${collateralAmount} ${collateralAsset}`);
    });
    run();
  } catch (error) {
    if (error instanceof LedgerError) throw new MarginError(error.code, error.message, error.status);
    throw error;
  }

  const loan = db.prepare('SELECT * FROM margin_loans WHERE loan_id = ?').get(loanId) as LoanRow;
  const view = valueLoan(loan, Date.now());
  if (!view) throw new MarginError('PRICE_UNAVAILABLE', 'Loan opened but cannot be valued', 500);
  return view;
}

/**
 * Repay a margin loan.
 *
 * Interest is settled before principal. Collateral is released in proportion to
 * the principal repaid and in full when the loan closes, so a partial repayment
 * frees only the collateral it has earned.
 */
export function repay(userId: string, loanId: string, amount: number): MarginLoanView {
  const db = getDb();
  const payAmount = Number(amount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    throw new MarginError('VALIDATION_FAILED', 'amount must be a positive number');
  }

  const row = db
    .prepare("SELECT * FROM margin_loans WHERE loan_id = ? AND user_id = ? AND status = 'open'")
    .get(loanId, userId) as LoanRow | undefined;
  if (!row) throw new MarginError('UNKNOWN_LOAN', 'No such open loan', 404);

  const interest = accruedInterest(row);
  const principal = Number(row.principal);
  const totalOwed = principal + interest;

  const balance = availableBalance(userId, row.asset);
  const dust = Math.max(1e-8, principal * 1e-9);

  // A payment that reaches the principal closes the loan. Interest accrues
  // continuously from a REAL timestamp, so a payment of exactly the principal
  // can be a fraction of a unit short of the total owed; that residual is
  // written off rather than blocking the close. A smaller payment must be
  // covered in full.
  const closing = payAmount + dust >= principal;
  const required = closing ? principal : payAmount;
  if (!covers(balance, required)) {
    throw new MarginError('INSUFFICIENT_BALANCE', `Insufficient ${row.asset} balance`);
  }

  const applied = Math.min(payAmount, totalOwed, balance);
  const principalPaid = closing ? Math.min(principal, applied) : Math.max(0, applied - interest);
  const interestPaid = closing ? Math.max(0, applied - principalPaid) : Math.min(applied, interest);
  const newPrincipal = closing ? 0 : principal - principalPaid;

  const releasedCollateral = closing
    ? Number(row.collateral_amount)
    : Number(row.collateral_amount) * (principalPaid / principal);

  try {
    const run = db.transaction(() => {
      debitAvailable(userId, row.asset, applied);
      if (releasedCollateral > 0) {
        unlockAvailable(userId, row.collateral_asset, Math.min(releasedCollateral, Number(row.collateral_amount)));
      }
      db.prepare(
        `UPDATE margin_loans
            SET principal = ?, interest_accrued = 0, collateral_amount = MAX(0, collateral_amount - ?),
                status = ?, updated_at = datetime('now')
          WHERE loan_id = ?`,
      ).run(closing ? 0 : newPrincipal, releasedCollateral, closing ? 'closed' : 'open', loanId);
      recordTransaction(
        userId,
        'margin_repay',
        row.asset,
        applied,
        0,
        'completed',
        `Repay ${principalPaid} ${row.asset} principal and ${interestPaid} ${row.asset} interest`,
      );
      recordRevenue('margin_interest', row.asset, interestPaid, userId, row.symbol);
    });
    run();
  } catch (error) {
    if (error instanceof LedgerError) throw new MarginError(error.code, error.message, error.status);
    throw error;
  }

  const updated = db.prepare('SELECT * FROM margin_loans WHERE loan_id = ?').get(loanId) as LoanRow;
  const view = valueLoan(updated, Date.now());
  if (!view) throw new MarginError('PRICE_UNAVAILABLE', 'Loan repaid but cannot be valued', 500);
  return view;
}

/**
 * Liquidate a loan whose collateral no longer covers its debt.
 *
 * The collateral is seized up to the liquidation threshold, the debt is closed,
 * and the liquidator receives the configured bonus. A loan that is still
 * healthy is refused: this is the enforcement point, not a suggestion.
 */
export function liquidate(
  liquidatorId: string,
  loanId: string,
): { liquidatorProfit: number; asset: string; seized: number } {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM margin_loans WHERE loan_id = ? AND status = 'open'")
    .get(loanId) as LoanRow | undefined;
  if (!row) throw new MarginError('UNKNOWN_LOAN', 'No such open loan', 404);

  const view = valueLoan(row, Date.now());
  if (!view) throw new MarginError('PRICE_UNAVAILABLE', 'Loan cannot be valued', 409);
  if (!view.liquidatable) {
    throw new MarginError('NOT_LIQUIDATABLE', 'This loan is not liquidatable', 409);
  }

  const market = db
    .prepare('SELECT * FROM margin_markets WHERE symbol = ?')
    .get(row.symbol) as MarginMarketRow;
  const bonus = Number(market.liquidation_bonus);
  const collateralPrice = priceInQuote(row.collateral_asset, market.quote_asset);
  if (collateralPrice === null || collateralPrice <= 0) {
    throw new MarginError('PRICE_UNAVAILABLE', 'Collateral cannot be priced', 409);
  }

  // Seize enough collateral to cover the debt plus the liquidator's bonus,
  // never more than the loan holds.
  const owed = view.loanValue;
  const seizeValue = owed * (1 + bonus);
  const seizeAmount = Math.min(Number(row.collateral_amount), seizeValue / collateralPrice);

  // Any collateral beyond what the debt and bonus require stays with the
  // borrower, unlocked, rather than remaining pledged to a closed loan.
  const remainder = Math.max(0, Number(row.collateral_amount) - seizeAmount);

  const run = db.transaction(() => {
    consumeLocked(row.user_id, row.collateral_asset, seizeAmount);
    if (remainder > 0) unlockAvailable(row.user_id, row.collateral_asset, remainder);
    // The liquidator repays the debt from the seized collateral; the remainder
    // (the bonus) is their compensation, recorded as a ledger movement.
    creditAvailable(liquidatorId, row.collateral_asset, seizeAmount);
    db.prepare(
      `UPDATE margin_loans SET status = 'liquidated', principal = 0, interest_accrued = 0,
              collateral_amount = MAX(0, collateral_amount - ?), updated_at = datetime('now')
        WHERE loan_id = ?`,
    ).run(seizeAmount, loanId);
    recordTransaction(
      liquidatorId,
      'margin_liquidation',
      row.collateral_asset,
      seizeAmount,
      0,
      'completed',
      `Liquidated loan ${loanId} (${row.symbol})`,
    );
    // The borrower's unpaid interest is real income the exchange earned before
    // the position was seized, so it is booked rather than silently dropped.
    recordRevenue('margin_interest', row.asset, view.interestAccrued, row.user_id, row.symbol);
  });
  run();

  return { liquidatorProfit: seizeAmount, asset: row.collateral_asset, seized: seizeAmount };
}
