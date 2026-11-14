/**
 * Contract arithmetic for linear and inverse derivatives.
 *
 * A linear contract (`USDT_M`, `USDC_M`, `RUSD_M`, `RYUSD_M`, `TGR_M`) settles
 * in a USD stablecoin and its position value is `price * quantity * size`.
 * An inverse contract (`COIN_M`) settles in the base coin and its value is
 * `quantity * size / price`, so the position is worth *more* coin as the price
 * falls. Running inverse P&L or margin through the linear formula overstates a
 * winning short and understates a losing long, so every money path must branch
 * on the contract type.
 *
 * These functions are pure and fail closed on non-finite inputs, so they can be
 * exercised directly.
 */

export type ContractSide = 'long' | 'short';

/** The only inverse contract type the venue lists (COIN-margined). */
export function isInverseContract(contractType: string): boolean {
  return String(contractType).trim().toUpperCase() === 'COIN_M';
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Position notional in USD.
 *
 * For a linear contract it is `price * quantity * size`; for an inverse one the
 * size is already denominated in USD, so it is `quantity * size` and does not
 * depend on price.
 */
export function notionalUsd(
  quantity: number,
  price: number,
  contractSize: number,
  inverse: boolean,
): number {
  const q = finite(quantity);
  const p = finite(price);
  const c = finite(contractSize);
  if (q === null || p === null || c === null) return NaN;
  return inverse ? q * c : p * q * c;
}

/** Position value denominated in the contract's settlement asset. */
export function positionValue(
  quantity: number,
  price: number,
  contractSize: number,
  inverse: boolean,
): number {
  const q = finite(quantity);
  const p = finite(price);
  const c = finite(contractSize);
  if (q === null || p === null || c === null || p === 0) return NaN;
  return inverse ? (q * c) / p : p * q * c;
}

/**
 * Unrealized P&L in the settlement asset.
 *
 * Linear: `(mark - entry) * quantity * size`, signed by the position side.
 * Inverse: `direction * quantity * size * (1/entry - 1/mark)`, so a long gains
 * coin as the price rises and a short gains coin as it falls.
 */
export function unrealizedPnl(input: {
  inverse: boolean;
  side: ContractSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  contractSize: number;
}): number {
  const { inverse, side, quantity, entryPrice, markPrice, contractSize } = input;
  const q = finite(quantity);
  const entry = finite(entryPrice);
  const mark = finite(markPrice);
  const c = finite(contractSize);
  if (q === null || entry === null || mark === null || c === null || entry === 0 || mark === 0) return NaN;
  const direction = side === 'long' ? 1 : -1;
  if (inverse) return direction * q * c * (1 / entry - 1 / mark);
  return (mark - entry) * q * c * direction;
}

/**
 * Margin required to open, in the settlement asset.
 *
 * `notional / leverage`, where the notional is read in the settlement asset:
 * for a linear contract that is `price * quantity * size`; for an inverse one
 * the USD notional is divided by price to convert it to coin.
 */
export function requiredMargin(input: {
  inverse: boolean;
  quantity: number;
  price: number;
  contractSize: number;
  leverage: number;
}): number {
  const { inverse, quantity, price, contractSize, leverage } = input;
  const lev = finite(leverage);
  if (lev === null || lev <= 0) return NaN;
  return positionValue(quantity, price, contractSize, inverse) / lev;
}

/**
 * Liquidation price: the mark at which equity equals maintenance margin.
 *
 * Equity = margin + unrealized P&L; maintenance margin is the position value
 * times the rate. For a linear contract this solves to the familiar
 * `P = (margin - entry*q*c*dir) / (q*c*(mmr - dir))`. For an inverse contract
 * the P&L is in coin, so the maintenance margin in coin is
 * `q*c*mmr/P`, and solving `margin + dir*q*c*(1/entry - 1/P) = q*c*mmr/P`
 * gives `P = q*c*(mmr + dir) / (margin + dir*q*c/entry)`. A long can be
 * liquidated (P below entry); a short's liquidation price sits above entry.
 * Returns 0 when no positive solution exists (an over-collateralised position).
 */
export function liquidationPrice(input: {
  inverse: boolean;
  side: ContractSide;
  quantity: number;
  entryPrice: number;
  contractSize: number;
  margin: number;
  maintenanceMarginRate: number;
}): number {
  const { inverse, side, quantity, entryPrice, contractSize, margin, maintenanceMarginRate } = input;
  const q = finite(quantity);
  const entry = finite(entryPrice);
  const c = finite(contractSize);
  const m = finite(margin);
  const mmr = finite(maintenanceMarginRate);
  if (q === null || entry === null || c === null || m === null || mmr === null) return 0;
  if (q <= 0 || entry <= 0 || c <= 0 || mmr <= 0 || mmr >= 1) return 0;
  const direction = side === 'long' ? 1 : -1;

  if (inverse) {
    const numerator = q * c * (mmr + direction);
    const denominator = m + (direction * q * c) / entry;
    if (denominator === 0) return 0;
    const price = numerator / denominator;
    return Number.isFinite(price) && price > 0 ? price : 0;
  }

  const denominator = q * c * (mmr - direction);
  if (denominator === 0) return 0;
  const price = (m - entry * q * c * direction) / denominator;
  return Number.isFinite(price) && price > 0 ? price : 0;
}
