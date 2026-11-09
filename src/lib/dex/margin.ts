/**
 * TigerSwap spot-margin and lending mathematics.
 *
 * Implements the borrow/supply interest model with a kink and jump multiplier,
 * the health factor of a borrow against its collateral, the maximum a position
 * may borrow, and the liquidation bonus a keeper earns. These mirror the
 * lending-pool contract rules and are pure, so the same numbers are produced by
 * the settlement engine and the API.
 */

import { AmmError } from '@/lib/dex/amm';

function nonNegative(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) throw new AmmError('INVALID_AMOUNT', `${name} must not be negative`);
  return n;
}

function fraction(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new AmmError('INVALID_RATE', `${name} must be a fraction in [0, 1]`);
  }
  return n;
}

export interface InterestModel {
  /** Base annual rate applied at zero utilisation. */
  baseRate: number;
  /** Utilisation at which the slope steepens, a fraction in (0, 1]. */
  kink: number;
  /** Multiplier applied to the slope beyond the kink. */
  jumpMultiplier: number;
}

/**
 * Utilisation of a lending market: borrowed divided by supplied.
 *
 * A market with no supply has zero utilisation by definition, and a borrow
 * cannot exceed the supply, so the result is always in [0, 1].
 */
export function utilization(totalBorrow: number, totalSupply: number): number {
  const borrow = nonNegative(totalBorrow, 'totalBorrow');
  const supply = nonNegative(totalSupply, 'totalSupply');
  if (supply === 0) return 0;
  if (borrow > supply) throw new AmmError('INVALID_STATE', 'borrow exceeds supply');
  return borrow / supply;
}

/**
 * Annual borrow rate at a utilisation.
 *
 * Below the kink the rate rises linearly from the base rate to the kink rate;
 * above it the slope is multiplied by `jumpMultiplier`, which is what makes a
 * near-fully-borrowed market expensive enough to attract repayments.
 */
export function borrowRate(model: InterestModel, util: number): number {
  const u = fraction(util, 'utilization');
  const base = fraction(model.baseRate, 'baseRate');
  const kink = fraction(model.kink, 'kink');
  if (kink <= 0) throw new AmmError('INVALID_RATE', 'kink must be greater than zero');
  if (!Number.isFinite(model.jumpMultiplier) || model.jumpMultiplier < 1) {
    throw new AmmError('INVALID_RATE', 'jumpMultiplier must be at least 1');
  }
  if (u <= kink) {
    return base + ((1 - base) * u) / kink;
  }
  const kinkRate = base + (1 - base);
  return kinkRate + ((u - kink) / (1 - kink)) * model.jumpMultiplier * (1 - base);
}

/** Annual supply rate: the borrow rate weighted by utilisation, minus reserve. */
export function supplyRate(model: InterestModel, util: number, reserveFactor = 0): number {
  const u = fraction(util, 'utilization');
  const reserve = fraction(reserveFactor, 'reserveFactor');
  return borrowRate(model, u) * u * (1 - reserve);
}

/**
 * Maximum a position may borrow against collateral.
 *
 * `collateralValue * ltv`, with the LTV taken from the collateral asset's own
 * listing row, so a volatile asset cannot borrow at the rate of a stable one.
 */
export function maxBorrow(collateralValue: number, ltv: number): number {
  const value = nonNegative(collateralValue, 'collateralValue');
  return value * fraction(ltv, 'ltv');
}

/**
 * Health factor of a borrow.
 *
 * `health = collateralValue * liquidationThreshold / debt`, so a value below 1
 * means the position is liquidatable. A position with no debt is infinitely
 * healthy and is reported as `Infinity` rather than a sentinel.
 */
export function healthFactor(collateralValue: number, liquidationThreshold: number, debt: number): number {
  const value = nonNegative(collateralValue, 'collateralValue');
  const threshold = fraction(liquidationThreshold, 'liquidationThreshold');
  const owed = nonNegative(debt, 'debt');
  if (owed === 0) return Infinity;
  return (value * threshold) / owed;
}

/** Whether a borrow is liquidatable at the current collateral value. */
export function isLiquidatable(collateralValue: number, liquidationThreshold: number, debt: number): boolean {
  return healthFactor(collateralValue, liquidationThreshold, debt) < 1;
}

export interface LiquidationResult {
  /** Debt repaid by the liquidator, in debt units. */
  debtRepaid: number;
  /** Value of the collateral seized, including the bonus, in debt units. */
  seizedValue: number;
  /** The bonus portion of the seized value, in debt units. */
  bonusValue: number;
}

/**
 * A partial liquidation.
 *
 * The liquidator repays at most `closeFactor` of the debt and receives
 * collateral worth the repayment plus the liquidation bonus. Every amount here
 * is in the debt asset's value — `debtValue` is the value of `debt` — and the
 * seizure is capped at `collateralValue`, so a liquidator can never take more
 * collateral than the position holds. The caller converts `seizedValue` and
 * `bonusValue` into collateral units by dividing by the collateral price; that
 * conversion cannot happen here because this function never sees the price.
 */
export function liquidate(
  debt: number,
  collateralValue: number,
  debtValue: number,
  liquidationBonus: number,
  closeFactor = 0.5,
): LiquidationResult {
  const owed = nonNegative(debt, 'debt');
  const collateral = nonNegative(collateralValue, 'collateralValue');
  const owedValue = nonNegative(debtValue, 'debtValue');
  const bonus = fraction(liquidationBonus, 'liquidationBonus');
  const factor = fraction(closeFactor, 'closeFactor');
  if (owed === 0 || collateral === 0) throw new AmmError('NOT_LIQUIDATABLE', 'position has no debt or collateral');

  const debtRepaid = Math.min(owed, owed * factor);
  const repaidValue = owedValue * (debtRepaid / owed);
  const seizedValue = Math.min(collateral, repaidValue * (1 + bonus));
  // When the collateral is worth less than the repayment the seizure is capped
  // at the collateral and the liquidator absorbs the shortfall; the bonus is
  // reported as zero rather than negative, since a bonus is never a charge.
  return {
    debtRepaid,
    seizedValue,
    bonusValue: Math.max(0, seizedValue - repaidValue),
  };
}

/**
 * Flash-loan fee: a flat fraction of the borrowed amount, paid in the same
 * asset within the same transaction.
 */
export function flashLoanFee(amount: number, feeRate: number): number {
  return nonNegative(amount, 'amount') * fraction(feeRate, 'feeRate');
}

/**
 * Interest accrued on a borrow over a period, simple and non-compounding, which
 * is what the pool charges per accrual tick.
 */
export function accruedInterest(principal: number, annualRate: number, seconds: number): number {
  const p = nonNegative(principal, 'principal');
  const rate = nonNegative(annualRate, 'annualRate');
  const elapsed = nonNegative(seconds, 'seconds');
  return (p * rate * elapsed) / (365 * 24 * 60 * 60);
}
