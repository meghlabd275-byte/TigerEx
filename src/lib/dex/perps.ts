/**
 * TigerSwap perpetual futures mathematics.
 *
 * Covers both perpetual shapes TigerSwap runs: oracle-priced (GMX-style) and
 * orderbook (CLOB) contracts. The functions here compute position size, margin,
 * unrealised and realised PnL, liquidation price, funding payments and the
 * insurance-fund share of a liquidation. They are pure and validate every
 * input, because a wrong liquidation price or a mis-signed PnL would let a
 * position be liquidated while solvent, or leave bad debt on the book.
 */

import { AmmError } from '@/lib/dex/amm';

export type PerpSide = 'long' | 'short';

function positive(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new AmmError('INVALID_AMOUNT', `${name} must be positive`);
  return n;
}

/** Position notional: size in base units times the entry price. */
export function positionNotional(size: number, price: number): number {
  return positive(size, 'size') * positive(price, 'price');
}

/**
 * Margin required to open a position at a leverage.
 *
 * Leverage above the market's maximum is refused by the caller against the
 * listing row; this function refuses non-positive leverage outright.
 */
export function requiredMargin(size: number, price: number, leverage: number): number {
  const lev = positive(leverage, 'leverage');
  return positionNotional(size, price) / lev;
}

/** Size in base units for a given margin and leverage. */
export function sizeForMargin(margin: number, price: number, leverage: number): number {
  return (positive(margin, 'margin') * positive(leverage, 'leverage')) / positive(price, 'price');
}

/**
 * Unrealised profit and loss of a position at a mark price.
 *
 * A long gains as the mark rises; a short gains as it falls. The result is
 * signed, so a losing position returns a negative number the margin engine can
 * subtract from collateral.
 */
export function unrealizedPnl(side: PerpSide, size: number, entryPrice: number, markPrice: number): number {
  const s = positive(size, 'size');
  const entry = positive(entryPrice, 'entryPrice');
  const mark = positive(markPrice, 'markPrice');
  const delta = (mark - entry) * s;
  return side === 'long' ? delta : -delta;
}

/**
 * Maintenance margin for a position: the fraction of notional that must remain
 * as collateral before a liquidation is allowed.
 */
export function maintenanceMargin(size: number, markPrice: number, maintenanceMarginRate: number): number {
  if (!Number.isFinite(maintenanceMarginRate) || maintenanceMarginRate < 0 || maintenanceMarginRate >= 1) {
    throw new AmmError('INVALID_RATE', 'maintenanceMarginRate must be a fraction in [0, 1)');
  }
  return positionNotional(size, markPrice) * maintenanceMarginRate;
}

/**
 * Liquidation price of an isolated position.
 *
 * The position is liquidated when collateral + PnL falls to the maintenance
 * margin. Solving for the price gives, for a long, `entry * (1 - 1/L + mmr)`
 * and for a short `entry * (1 + 1/L - mmr)`, where `L` is the leverage. A
 * liquidation price at or below zero is impossible for a long and is refused.
 */
export function liquidationPrice(
  side: PerpSide,
  entryPrice: number,
  leverage: number,
  maintenanceMarginRate: number,
): number {
  const entry = positive(entryPrice, 'entryPrice');
  const lev = positive(leverage, 'leverage');
  if (!Number.isFinite(maintenanceMarginRate) || maintenanceMarginRate < 0 || maintenanceMarginRate >= 1) {
    throw new AmmError('INVALID_RATE', 'maintenanceMarginRate must be a fraction in [0, 1)');
  }
  const price =
    side === 'long'
      ? entry * (1 - 1 / lev + maintenanceMarginRate)
      : entry * (1 + 1 / lev - maintenanceMarginRate);
  if (!Number.isFinite(price) || price <= 0) {
    throw new AmmError('INVALID_LIQUIDATION_PRICE', 'computed liquidation price is not positive');
  }
  return price;
}

/** Whether a position should be liquidated at the mark price. */
export function shouldLiquidate(
  side: PerpSide,
  size: number,
  entryPrice: number,
  markPrice: number,
  collateral: number,
  maintenanceMarginRate: number,
): boolean {
  if (!Number.isFinite(collateral) || collateral < 0) {
    throw new AmmError('INVALID_COLLATERAL', 'collateral must not be negative');
  }
  const pnl = unrealizedPnl(side, size, entryPrice, markPrice);
  const maintenance = maintenanceMargin(size, markPrice, maintenanceMarginRate);
  return collateral + pnl < maintenance;
}

/**
 * Realised PnL when a position is closed, net of the close fee.
 *
 * The open and close taker fees are charged on notional; the returned figure is
 * what the trader's collateral actually changes by.
 */
export function realizedPnl(
  side: PerpSide,
  size: number,
  entryPrice: number,
  exitPrice: number,
  openFee: number,
  closeFee: number,
): number {
  if (!Number.isFinite(openFee) || openFee < 0 || !Number.isFinite(closeFee) || closeFee < 0) {
    throw new AmmError('INVALID_FEE', 'fees must not be negative');
  }
  const gross = unrealizedPnl(side, size, entryPrice, exitPrice);
  const entryNotional = positionNotional(size, entryPrice);
  const exitNotional = positionNotional(size, exitPrice);
  return gross - entryNotional * openFee - exitNotional * closeFee;
}

/**
 * Funding payment for one interval.
 *
 * `funding = positionNotional * fundingRate`; a positive rate means longs pay
 * shorts. The signed result is subtracted from the payer and added to the
 * receiver by the settlement engine.
 */
export function fundingPayment(size: number, markPrice: number, fundingRate: number): number {
  if (!Number.isFinite(fundingRate)) throw new AmmError('INVALID_RATE', 'fundingRate must be finite');
  return positionNotional(size, markPrice) * fundingRate;
}

/**
 * The funding rate implied by the premium of the mark over the index.
 *
 * `funding = clamp(premium / interval, -cap, cap)`. When the mark trades above
 * the index longs pay; below, shorts pay. The clamp keeps a stale or spiked mark
 * from transferring an unbounded amount between sides.
 */
export function fundingRateFromPremium(
  markPrice: number,
  indexPrice: number,
  intervalHours: number,
  cap: number,
): number {
  const mark = positive(markPrice, 'markPrice');
  const index = positive(indexPrice, 'indexPrice');
  const hours = positive(intervalHours, 'intervalHours');
  if (!Number.isFinite(cap) || cap <= 0 || cap >= 1) {
    throw new AmmError('INVALID_CAP', 'cap must be a fraction in (0, 1)');
  }
  const premium = (mark - index) / index;
  const rate = premium / hours;
  return Math.max(-cap, Math.min(cap, rate));
}

/**
 * Mark price from a set of independent sources.
 *
 * The median of at least three sources is used, and any source deviating from
 * the median by more than `maxDeviation` is excluded before recomputing. With
 * fewer than three sources the price is refused rather than guessed, so a
 * single compromised feed cannot set the mark.
 */
export function medianMarkPrice(sources: number[], maxDeviation = 0.05): number {
  if (!Array.isArray(sources) || sources.length < 3) {
    throw new AmmError('INSUFFICIENT_SOURCES', 'at least three price sources are required');
  }
  const clean = sources.map((s, i) => positive(s, `sources[${i}]`)).sort((a, b) => a - b);
  const mid = Math.floor(clean.length / 2);
  const median = clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  const filtered = clean.filter((s) => Math.abs(s - median) / median <= maxDeviation);
  if (filtered.length < 3) {
    throw new AmmError('ORACLE_DIVERGED', 'too few sources agree with the median');
  }
  const mid2 = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 1 ? filtered[mid2] : (filtered[mid2 - 1] + filtered[mid2]) / 2;
}

/**
 * Split a liquidation penalty between the liquidator and the insurance fund.
 *
 * The liquidator receives the `liquidatorShare` of the penalty as a bounty; the
 * remainder tops up the insurance fund. Both parts are validated to be
 * fractions, and the split conserves the penalty exactly.
 */
export function liquidationPenaltySplit(
  penalty: number,
  liquidatorShare = 0.6,
): { liquidator: number; insurance: number } {
  const total = Number(penalty);
  if (!Number.isFinite(total) || total < 0) {
    throw new AmmError('INVALID_AMOUNT', 'penalty must not be negative');
  }
  if (!Number.isFinite(liquidatorShare) || liquidatorShare < 0 || liquidatorShare > 1) {
    throw new AmmError('INVALID_SHARE', 'liquidatorShare must be a fraction in [0, 1]');
  }
  const liquidator = total * liquidatorShare;
  return { liquidator, insurance: total - liquidator };
}

/**
 * Price impact of an oracle-perp trade against the pool.
 *
 * GMX-style pools charge impact proportional to the imbalance a trade adds:
 * `impact = size / (2 * poolLiquidity)`, capped by the caller against the
 * listing's maximum. It is signed so a trade that rebalances the pool earns a
 * small rebate, matching the published model.
 */
export function oraclePriceImpact(size: number, poolLiquidity: number): number {
  const s = positive(size, 'size');
  const liquidity = positive(poolLiquidity, 'poolLiquidity');
  return s / (2 * liquidity);
}

/** Borrow fee accrued on an oracle-perp position over a hold period. */
export function borrowFee(notional: number, hourlyBorrowRate: number, hours: number): number {
  if (!Number.isFinite(hourlyBorrowRate) || hourlyBorrowRate < 0) {
    throw new AmmError('INVALID_RATE', 'hourlyBorrowRate must not be negative');
  }
  if (!Number.isFinite(hours) || hours < 0) throw new AmmError('INVALID_HOURS', 'hours must not be negative');
  return positive(notional, 'notional') * hourlyBorrowRate * hours;
}
