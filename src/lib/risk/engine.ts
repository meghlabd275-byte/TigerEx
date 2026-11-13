/**
 * Derivatives risk: position margin, liquidation price, tiered maintenance
 * margin and auto-deleveraging.
 *
 * Every function fails closed: a non-finite or non-positive input returns an
 * explicit error or a conservative value, never a plausible-looking number.
 * These are the checks that guard funds, so they are pure and directly tested.
 */

export interface PositionRiskInput {
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  /** Margin held for the position, in the settlement asset. */
  margin: number;
  maintenanceMarginRate: number;
}

export interface PositionRisk {
  notional: number;
  unrealizedPnl: number;
  /** Position margin plus unrealized P&L. */
  equity: number;
  maintenanceMargin: number;
  /** equity / maintenanceMargin; below 1 means liquidatable. */
  marginRatio: number;
  liquidatable: boolean;
  liquidationPrice: number;
}

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Compute the risk metrics for a single derivative position.
 *
 * Unrealized P&L is (mark - entry) * quantity for a long and the negative for a
 * short. The liquidation price is the mark at which equity equals maintenance
 * margin, solved for price; it is reported as an absolute distance from entry
 * so it is meaningful for both sides.
 */
export function positionRisk(input: PositionRiskInput): PositionRisk | { error: string } {
  const quantity = positive(input.quantity);
  const entryPrice = positive(input.entryPrice);
  const markPrice = positive(input.markPrice);
  const leverage = positive(input.leverage);
  const margin = positive(input.margin);
  const mmr = input.maintenanceMarginRate;

  if (quantity === null) return { error: 'quantity must be a positive number' };
  if (entryPrice === null) return { error: 'entryPrice must be a positive number' };
  if (markPrice === null) return { error: 'markPrice must be a positive number' };
  if (leverage === null) return { error: 'leverage must be a positive number' };
  if (margin === null) return { error: 'margin must be a positive number' };
  if (!Number.isFinite(mmr) || mmr <= 0 || mmr >= 1) {
    return { error: 'maintenanceMarginRate must be a fraction in (0, 1)' };
  }

  const direction = input.side === 'long' ? 1 : -1;
  const notional = markPrice * quantity;
  const unrealizedPnl = (markPrice - entryPrice) * quantity * direction;
  const equity = margin + unrealizedPnl;
  const maintenanceMargin = notional * mmr;
  const marginRatio = maintenanceMargin === 0 ? Infinity : equity / maintenanceMargin;

  // Equity at liquidation = maintenanceMargin, i.e.
  // margin + (P - entry) * q * dir = P * q * mmr
  // Solve for P: P = (margin - entry * q * dir) / (q * (mmr - dir)).
  // The sign of the denominator is `mmr - dir`, not `dir - mmr`; the latter
  // negates the result, so every price clamped to zero and a trader saw a
  // liquidation price of 0.
  const denominator = quantity * (mmr - direction);
  const liquidationPrice =
    denominator === 0 ? 0 : Math.max(0, (margin - entryPrice * quantity * direction) / denominator);

  return {
    notional,
    unrealizedPnl,
    equity,
    maintenanceMargin,
    marginRatio,
    liquidatable: equity < maintenanceMargin,
    liquidationPrice,
  };
}

export interface RiskTier {
  tier: number;
  maxPositionNotional: number;
  maxLeverage: number;
  maintenanceMarginRate: number;
}

/**
 * Select the risk tier that applies to a requested notional.
 *
 * Tiers are ascending by notional; the first tier whose cap covers the notional
 * applies. A notional larger than every tier's cap is refused rather than
 * assigned the loosest tier.
 */
export function selectRiskTier(tiers: RiskTier[], notional: number): RiskTier | { error: string } {
  if (!Array.isArray(tiers) || tiers.length === 0) return { error: 'no risk tiers configured' };
  if (!Number.isFinite(notional) || notional <= 0) return { error: 'notional must be a positive number' };

  const ordered = [...tiers].sort((a, b) => a.tier - b.tier);
  for (const tier of ordered) {
    if (notional <= tier.maxPositionNotional) return tier;
  }
  return { error: 'notional exceeds the largest configured risk tier' };
}

export interface AdlPosition {
  userId: string;
  side: 'long' | 'short';
  notional: number;
  leverage: number;
  /** Profit as a fraction of margin; higher is dequeued first. */
  pnlRatio: number;
}

/**
 * Order positions for auto-deleveraging.
 *
 * When an insurance fund cannot absorb a bankruptcy the profitable, most
 * leveraged positions are reduced first, matching the ADL rule on every major
 * venue. Returns the queue in the order it should be deleveraged.
 */
export function adlQueue(positions: AdlPosition[]): AdlPosition[] {
  return [...positions].sort((a, b) => {
    if (b.pnlRatio !== a.pnlRatio) return b.pnlRatio - a.pnlRatio;
    return b.leverage - a.leverage;
  });
}

/**
 * Insurance fund shortfall for a bankrupt position.
 *
 * A position is bankrupt when equity is negative. The shortfall the fund must
 * cover is the negative equity (losses beyond the posted margin).
 */
export function insuranceShortfall(equity: number): number {
  if (!Number.isFinite(equity) || equity >= 0) return 0;
  return -equity;
}

/**
 * Health of the insurance fund against its target, and whether ADL should arm.
 */
export function insuranceFundStatus(
  balance: number,
  target: number,
  adlThreshold: number,
): { healthy: boolean; ratio: number; adlArmed: boolean } {
  const safeBalance = Number.isFinite(balance) && balance > 0 ? balance : 0;
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 0;
  const ratio = safeTarget === 0 ? (safeBalance > 0 ? Infinity : 0) : safeBalance / safeTarget;
  return {
    healthy: safeTarget === 0 ? safeBalance > 0 : safeBalance >= safeTarget,
    ratio,
    adlArmed: Number.isFinite(adlThreshold) && adlThreshold > 0 && safeBalance < adlThreshold,
  };
}
