/**
 * TigerSwap fee and revenue engine.
 *
 * Every fee TigerSwap charges is split by a published schedule: swap fees fund
 * the liquidity providers, the veTGR voters and the treasury; perpetual fees
 * fund the insurance fund, the veTGR voters and the treasury. The splits are
 * operator settings (basis points) rather than constants so they can be tuned
 * without a redeploy, and each is validated so a schedule can never sum to more
 * than the fee it divides.
 */

import { AmmError } from '@/lib/dex/amm';

/** Basis points in one whole unit; 10000 bps = 100%. */
export const BPS = 10_000;

export interface FeeSplit {
  /** Portion that stays with the liquidity providers. */
  lp: number;
  /** Portion distributed to veTGR holders. */
  vetgr: number;
  /** Portion routed to the protocol treasury. */
  treasury: number;
  /** Portion routed to the insurance fund. */
  insurance: number;
  /** Portion used to buy back and burn TGR. */
  burn: number;
}

export interface SplitSchedule {
  lpBps: number;
  vetgrBps: number;
  treasuryBps: number;
  insuranceBps: number;
  burnBps: number;
}

function assertBps(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > BPS) {
    throw new AmmError('INVALID_SCHEDULE', `${name} must be an integer in [0, ${BPS}]`);
  }
}

/** Validate a split schedule and confirm it sums to exactly 10000 bps. */
export function validateSchedule(schedule: SplitSchedule): SplitSchedule {
  assertBps(schedule.lpBps, 'lpBps');
  assertBps(schedule.vetgrBps, 'vetgrBps');
  assertBps(schedule.treasuryBps, 'treasuryBps');
  assertBps(schedule.insuranceBps, 'insuranceBps');
  assertBps(schedule.burnBps, 'burnBps');
  const total =
    schedule.lpBps + schedule.vetgrBps + schedule.treasuryBps + schedule.insuranceBps + schedule.burnBps;
  if (total !== BPS) {
    throw new AmmError('INVALID_SCHEDULE', `schedule must sum to ${BPS} bps, got ${total}`);
  }
  return schedule;
}

/**
 * Apply a schedule to a fee amount.
 *
 * The remainder (from integer division) is added to the largest bucket so the
 * parts always sum back to the original fee; a split that lost or created a
 * fraction of a token would not balance the revenue ledger.
 */
export function applySchedule(amount: number, schedule: SplitSchedule): FeeSplit {
  const fee = Number(amount);
  if (!Number.isFinite(fee) || fee < 0) {
    throw new AmmError('INVALID_AMOUNT', 'fee amount must be a non-negative finite number');
  }
  validateSchedule(schedule);

  const raw: FeeSplit = {
    lp: (fee * schedule.lpBps) / BPS,
    vetgr: (fee * schedule.vetgrBps) / BPS,
    treasury: (fee * schedule.treasuryBps) / BPS,
    insurance: (fee * schedule.insuranceBps) / BPS,
    burn: (fee * schedule.burnBps) / BPS,
  };
  const parts = raw.lp + raw.vetgr + raw.treasury + raw.insurance + raw.burn;
  const drift = fee - parts;
  if (drift !== 0) {
    const buckets: Array<keyof FeeSplit> = ['lp', 'vetgr', 'treasury', 'insurance', 'burn'];
    let largest: keyof FeeSplit = 'lp';
    for (const bucket of buckets) if (raw[bucket] > raw[largest]) largest = bucket;
    raw[largest] += drift;
  }
  return raw;
}

/** The default swap-fee split: 70% LPs, 20% veTGR, 10% treasury. */
export const DEFAULT_SWAP_SPLIT: SplitSchedule = {
  lpBps: 7000,
  vetgrBps: 2000,
  treasuryBps: 1000,
  insuranceBps: 0,
  burnBps: 0,
};

/** The default perpetual-fee split: 40% insurance, 40% veTGR, 20% treasury. */
export const DEFAULT_PERP_SPLIT: SplitSchedule = {
  lpBps: 0,
  vetgrBps: 4000,
  treasuryBps: 2000,
  insuranceBps: 4000,
  burnBps: 0,
};

/** Sum the parts of a split back to a single number. */
export function splitTotal(split: FeeSplit): number {
  return split.lp + split.vetgr + split.treasury + split.insurance + split.burn;
}

/**
 * Convert an annual percentage rate into the per-second rate used to accrue
 * farm rewards, so a reward stream is continuous rather than block-clocked.
 */
export function aprToPerSecond(apr: number): number {
  if (!Number.isFinite(apr) || apr < 0) {
    throw new AmmError('INVALID_APR', 'apr must be a non-negative finite number');
  }
  return apr / (365 * 24 * 60 * 60);
}

/** Effective APY for a nominal APR compounded `periodsPerYear` times. */
export function aprToApy(apr: number, periodsPerYear = 365): number {
  if (!Number.isFinite(apr) || apr < 0) {
    throw new AmmError('INVALID_APR', 'apr must be a non-negative finite number');
  }
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) {
    throw new AmmError('INVALID_PERIODS', 'periodsPerYear must be positive');
  }
  return Math.pow(1 + apr / periodsPerYear, periodsPerYear) - 1;
}
