/**
 * Leveraged token (ETF) NAV, rebalancing and management fee.
 *
 * A 3x long token tracks three times the daily return of its underlying. NAV
 * compounds daily, so the return over many days is not simply three times the
 * underlying's move — the rebalance drag is real and is modelled here rather
 * than ignored.
 */

export interface EtfState {
  /** Current net asset value per token, in the settlement asset. */
  nav: number;
  /** Leverage multiple; negative for an inverse token. */
  leverage: number;
  /** Reference price of the underlying at the last rebalance. */
  lastRebalancePrice: number;
  /** Timestamp of the last rebalance in nanoseconds. */
  lastRebalanceNs: number;
}

export interface EtfConfig {
  /** Rebalance when the day's move exceeds this fraction of leverage. */
  rebalanceThreshold: number;
  /** Annual management fee taken from NAV, as a fraction. */
  managementFeeApr: number;
}

export const DEFAULT_ETF_CONFIG: EtfConfig = {
  rebalanceThreshold: 0.05,
  managementFeeApr: 0.02,
};

/**
 * Apply a price move to a leveraged token's NAV.
 *
 * The token returns `leverage` times the underlying's fractional move. A move
 * that would drive NAV to zero or below is clamped to a floor: a leveraged
 * token cannot go negative, it is liquidated at zero.
 */
export function applyMove(state: EtfState, currentPrice: number): number | { error: string } {
  if (!Number.isFinite(state.nav) || state.nav <= 0) return { error: 'nav must be a positive number' };
  if (!Number.isFinite(state.lastRebalancePrice) || state.lastRebalancePrice <= 0) {
    return { error: 'lastRebalancePrice must be a positive number' };
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return { error: 'currentPrice must be a positive number' };
  if (!Number.isFinite(state.leverage) || state.leverage === 0) return { error: 'leverage must be non-zero' };

  const underlyingReturn = (currentPrice - state.lastRebalancePrice) / state.lastRebalancePrice;
  const tokenReturn = underlyingReturn * state.leverage;
  return Math.max(state.nav * (1 + tokenReturn), 0);
}

/**
 * Whether a rebalance is due.
 *
 * A daily rebalance restores the target leverage. It is triggered when the
 * token's drift from target exceeds the threshold, or when the calendar day
 * has rolled over since the last rebalance.
 */
export function rebalanceDue(
  state: EtfState,
  currentPrice: number,
  nowNs: number,
  config: EtfConfig = DEFAULT_ETF_CONFIG,
): boolean {
  const moved = applyMove(state, currentPrice);
  if (typeof moved === 'number' && state.nav > 0) {
    const tokenReturn = (moved - state.nav) / state.nav;
    if (Math.abs(tokenReturn) >= config.rebalanceThreshold * Math.abs(state.leverage)) return true;
  }
  const dayNs = 24 * 60 * 60 * 1e9;
  return Number.isFinite(state.lastRebalanceNs) && nowNs - state.lastRebalanceNs >= dayNs;
}

/**
 * Management fee accrued over a period, expressed in NAV terms.
 *
 * A management fee only ever reduces NAV; a negative or non-finite elapsed
 * period accrues nothing.
 */
export function managementFee(nav: number, elapsedNs: number, config: EtfConfig = DEFAULT_ETF_CONFIG): number {
  if (!Number.isFinite(nav) || nav <= 0) return 0;
  if (!Number.isFinite(elapsedNs) || elapsedNs <= 0) return 0;
  const yearNs = 365 * 24 * 60 * 60 * 1e9;
  const fraction = Math.min(elapsedNs / yearNs, 1);
  return nav * config.managementFeeApr * fraction;
}

/**
 * Number of tokens a subscription buys at the current NAV.
 */
export function tokensForDeposit(deposit: number, nav: number): number {
  if (!Number.isFinite(deposit) || deposit <= 0) return 0;
  if (!Number.isFinite(nav) || nav <= 0) return 0;
  return deposit / nav;
}

/**
 * Redemption value of a token balance at the current NAV, net of the exit fee.
 */
export function redemptionValue(tokens: number, nav: number, exitFeeRate = 0): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  if (!Number.isFinite(nav) || nav <= 0) return 0;
  const gross = tokens * nav;
  const fee = Number.isFinite(exitFeeRate) && exitFeeRate > 0 ? Math.min(exitFeeRate, 1) : 0;
  return gross * (1 - fee);
}
