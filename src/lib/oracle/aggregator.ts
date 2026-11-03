/**
 * Oracle aggregation: index price, mark price and funding rate.
 *
 * The exchange never takes a single feed as truth. The index price is the
 * weighted median of the fresh, non-deviating source prices, so one stale or
 * manipulated source cannot move it. The mark price is the index price blended
 * with the venue's own book so it tracks the last traded price without being
 * trivially pushed by a single trade.
 */

export interface OracleObservation {
  source: string;
  price: number;
  /** Publication time in nanoseconds. */
  publishedNs: number;
  weight: number;
}

export interface OracleConfig {
  /** Observations older than this are ignored. */
  maxAgeNs: number;
  /** A source further than this from the median is discarded. */
  maxDeviation: number;
  /** Minimum sources required to publish a price at all. */
  minSources: number;
}

export const DEFAULT_ORACLE_CONFIG: OracleConfig = {
  maxAgeNs: 60_000_000_000, // 60 seconds
  maxDeviation: 0.05,
  minSources: 2,
};

function weightedMedian(pairs: Array<{ price: number; weight: number }>): number | null {
  if (pairs.length === 0) return null;
  const sorted = [...pairs].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return null;
  const half = total / 2;
  let cumulative = 0;
  for (const pair of sorted) {
    cumulative += pair.weight;
    if (cumulative >= half) return pair.price;
  }
  return sorted[sorted.length - 1].price;
}

export type IndexResult =
  | { price: number; sourcesUsed: string[]; discarded: string[] }
  | { error: string };

/**
 * Aggregate source observations into an index price.
 *
 * A source is discarded when its timestamp is too old, its price is
 * non-finite or non-positive, or it deviates from the weighted median by more
 * than the configured tolerance. When fewer than `minSources` remain, no price
 * is published — the caller must pause the market rather than guess.
 */
export function indexPrice(
  observations: OracleObservation[],
  nowNs: number,
  config: OracleConfig = DEFAULT_ORACLE_CONFIG,
): IndexResult {
  const discarded: string[] = [];
  const fresh: OracleObservation[] = [];

  for (const obs of observations) {
    const price = Number(obs.price);
    const weight = Number(obs.weight);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(weight) || weight <= 0) {
      discarded.push(obs.source);
      continue;
    }
    if (!Number.isFinite(obs.publishedNs) || nowNs - obs.publishedNs > config.maxAgeNs) {
      discarded.push(obs.source);
      continue;
    }
    fresh.push({ ...obs, price, weight });
  }

  if (fresh.length < config.minSources) {
    return { error: `only ${fresh.length} fresh oracle source(s); ${config.minSources} required` };
  }

  const median = weightedMedian(fresh.map((o) => ({ price: o.price, weight: o.weight })));
  if (median === null) return { error: 'weighted median could not be computed' };

  const kept = fresh.filter((obs) => {
    const deviation = Math.abs(obs.price - median) / median;
    if (deviation > config.maxDeviation) {
      discarded.push(obs.source);
      return false;
    }
    return true;
  });

  if (kept.length < config.minSources) {
    return { error: `only ${kept.length} source(s) within tolerance; ${config.minSources} required` };
  }

  const finalPrice = weightedMedian(kept.map((o) => ({ price: o.price, weight: o.weight })));
  if (finalPrice === null) return { error: 'weighted median could not be computed' };

  return {
    price: finalPrice,
    sourcesUsed: kept.map((o) => o.source).sort(),
    discarded,
  };
}

/**
 * Mark price: the index price blended with the venue's own mid price.
 *
 * A book mid far from the index is pulled toward it, which is what stops a
 * thin book from being pushed to liquidate positions. When the book has no mid
 * the index price is used unchanged.
 */
export function markPrice(index: number, bookMid: number | null, blend = 0.5): number | { error: string } {
  if (!Number.isFinite(index) || index <= 0) return { error: 'index price must be a positive number' };
  if (bookMid === null) return index;
  if (!Number.isFinite(bookMid) || bookMid <= 0) return index;
  const w = Number.isFinite(blend) ? Math.min(Math.max(blend, 0), 1) : 0.5;
  return index * (1 - w) + bookMid * w;
}

/**
 * Funding rate for a perpetual contract.
 *
 * The premium is the mark-versus-index basis; the funding rate is the premium
 * plus a clamp to the configured cap and a floor so a flat market still pays
 * the interest component. Returns the rate as a fraction of position notional
 * charged over one funding interval.
 */
export function fundingRate(
  mark: number,
  index: number,
  interestRate: number,
  cap: number,
  floor = 0,
): number | { error: string } {
  if (!Number.isFinite(mark) || mark <= 0) return { error: 'mark price must be a positive number' };
  if (!Number.isFinite(index) || index <= 0) return { error: 'index price must be a positive number' };
  if (!Number.isFinite(cap) || cap <= 0) return { error: 'funding cap must be a positive number' };

  const premium = (mark - index) / index;
  const rate = premium + (Number.isFinite(interestRate) ? interestRate : 0);
  const lower = Number.isFinite(floor) ? floor : 0;
  return Math.min(Math.max(rate, lower), cap);
}

/**
 * Funding payment owed by a position at settlement.
 *
 * A long pays when the rate is positive and receives when it is negative; a
 * short is the mirror. `notional` is mark price times quantity.
 */
export function fundingPayment(notional: number, rate: number, side: 'long' | 'short'): number {
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  if (!Number.isFinite(rate)) return 0;
  const direction = side === 'long' ? -1 : 1;
  return notional * rate * direction;
}
