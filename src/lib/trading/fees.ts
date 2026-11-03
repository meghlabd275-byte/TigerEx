/**
 * Fee engine: VIP tiers, holding discounts and referral commission split.
 *
 * Rates are fractions of notional (0.001 = 10 bps). The engine is pure so it
 * can be tested directly and reused by the API layer and the revenue ledger.
 */

export interface FeeTier {
  level: number;
  name: string;
  spotMaker: number;
  spotTaker: number;
  futuresMaker: number;
  futuresTaker: number;
  /** 30-day traded volume in the quote asset required for this tier. */
  volumeThreshold: number;
  /** Native token holding required for this tier. */
  holdingThreshold: number;
}

export interface FeeContext {
  /** 30-day traded volume in USDT terms. */
  volume30d: number;
  /** Native token (TGR) holding. */
  holding: number;
  /** Whether the user pays fees in the native token (extra discount). */
  payInNative?: boolean;
}

export interface ResolvedFees {
  level: number;
  name: string;
  spotMaker: number;
  spotTaker: number;
  futuresMaker: number;
  futuresTaker: number;
  /** Applied when the user opts to pay in the native token. */
  nativeDiscount: number;
}

/** Discount applied to every rate when fees are paid in the native token. */
export const NATIVE_FEE_DISCOUNT = 0.25;
/** Discount applied when the quote asset is the exchange stablecoin. */
export const STABLECOIN_FEE_DISCOUNT = 0.1;

/**
 * Resolve the applicable tier for a context.
 *
 * A tier is granted only when both the volume and the holding requirement are
 * met, so a large holder with no volume cannot claim a maker rebate tier. Tiers
 * are evaluated from the highest level down so the best qualifying tier wins.
 */
export function resolveFeeTier(tiers: FeeTier[], context: FeeContext): ResolvedFees {
  if (tiers.length === 0) {
    throw new Error('fee schedule is empty');
  }
  const volume = Number.isFinite(context.volume30d) && context.volume30d > 0 ? context.volume30d : 0;
  const holding = Number.isFinite(context.holding) && context.holding > 0 ? context.holding : 0;

  const ordered = [...tiers].sort((a, b) => b.level - a.level);
  let chosen = ordered[ordered.length - 1];
  for (const tier of ordered) {
    if (volume >= tier.volumeThreshold && holding >= tier.holdingThreshold) {
      chosen = tier;
      break;
    }
  }

  const nativeDiscount = context.payInNative ? NATIVE_FEE_DISCOUNT : 0;
  const apply = (rate: number): number => Math.max(0, rate * (1 - nativeDiscount));

  return {
    level: chosen.level,
    name: chosen.name,
    spotMaker: apply(chosen.spotMaker),
    spotTaker: apply(chosen.spotTaker),
    futuresMaker: apply(chosen.futuresMaker),
    futuresTaker: apply(chosen.futuresTaker),
    nativeDiscount,
  };
}

export type MarketKind = 'spot' | 'futures';

/**
 * Pick the maker and taker rate for a market kind from a resolved fee set.
 */
export function ratesFor(fees: ResolvedFees, kind: MarketKind): { maker: number; taker: number } {
  return kind === 'spot'
    ? { maker: fees.spotMaker, taker: fees.spotTaker }
    : { maker: fees.futuresMaker, taker: fees.futuresTaker };
}

/**
 * Split a trading fee between the exchange and a referrer.
 *
 * `commissionRate` is the share of the fee paid to the referrer (0.4 = 40%).
 * The exchange keeps the remainder. Both values are returned so the revenue
 * ledger can record the net revenue rather than the gross fee.
 */
export function splitReferralCommission(
  fee: number,
  commissionRate: number,
): { referrerShare: number; exchangeShare: number } {
  if (!Number.isFinite(fee) || fee <= 0) return { referrerShare: 0, exchangeShare: 0 };
  const rate = Number.isFinite(commissionRate) ? Math.min(Math.max(commissionRate, 0), 1) : 0;
  const referrerShare = fee * rate;
  return { referrerShare, exchangeShare: fee - referrerShare };
}

/**
 * Margin borrow interest accrued over a period.
 *
 * Uses the kinked two-slope model every major venue uses: below the kink the
 * rate rises linearly from the base APR to the kink APR; above it, steeply to
 * the maximum. A single flat rate would under-price utilisation risk.
 */
export function borrowInterest(
  principal: number,
  utilization: number,
  baseApr: number,
  kinkUtilization: number,
  kinkApr: number,
  maxApr: number,
  hours: number,
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(hours) || hours <= 0) return 0;

  const u = Math.min(Math.max(Number.isFinite(utilization) ? utilization : 0, 0), 1);
  const kink = Number.isFinite(kinkUtilization) && kinkUtilization > 0 && kinkUtilization < 1
    ? kinkUtilization
    : 0.8;

  let apr: number;
  if (u <= kink) {
    apr = baseApr + (kinkApr - baseApr) * (u / kink);
  } else {
    apr = kinkApr + (maxApr - kinkApr) * ((u - kink) / (1 - kink));
  }

  const hourlyRate = apr / (365 * 24);
  return principal * hourlyRate * hours;
}
