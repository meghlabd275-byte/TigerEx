/**
 * VIP tiers and fee schedule views.
 *
 * The schedule itself is the `fee_schedule` table the trading engine already
 * reads, so the published fee page and the fee actually charged can never
 * disagree. A user's tier is resolved from their real 30-day volume and native
 * token holding, using the same `resolveFeeTier` the engine uses.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';
import { resolveFeeTier, type FeeTier } from '@/lib/trading/fees';
import { volume30d } from '@/lib/trading/spot-engine';
import { availableBalance } from '@/lib/db/ledger';

export interface VipLevelView {
  level: number;
  name: string;
  /** Maker fee as a fraction of notional. */
  maker_fee: number;
  taker_fee: number;
  spot_maker_fee: number;
  spot_taker_fee: number;
  volume_requirement: number;
  tgr_requirement: number;
}

function schedule(): FeeTier[] {
  const rows = getDb()
    .prepare('SELECT * FROM fee_schedule ORDER BY level')
    .all() as Array<{
    level: number;
    name: string;
    spot_maker_bps: number;
    spot_taker_bps: number;
    futures_maker_bps: number;
    futures_taker_bps: number;
    volume_threshold: number;
    tgr_holding_threshold: number;
  }>;

  return rows.map((row) => ({
    level: row.level,
    name: row.name,
    spotMaker: row.spot_maker_bps / 10000,
    spotTaker: row.spot_taker_bps / 10000,
    futuresMaker: row.futures_maker_bps / 10000,
    futuresTaker: row.futures_taker_bps / 10000,
    volumeThreshold: row.volume_threshold,
    holdingThreshold: row.tgr_holding_threshold,
  }));
}

/** The published VIP ladder. */
export function vipLevels(): VipLevelView[] {
  return schedule().map((tier) => ({
    level: tier.level,
    name: tier.name,
    // The headline rate is the futures rate; the spot rate is also published
    // because the two differ from VIP 1 onward.
    maker_fee: tier.futuresMaker,
    taker_fee: tier.futuresTaker,
    spot_maker_fee: tier.spotMaker,
    spot_taker_fee: tier.spotTaker,
    volume_requirement: tier.volumeThreshold,
    tgr_requirement: tier.holdingThreshold,
  }));
}

export interface VipInfo {
  current_level: number;
  level: number;
  name: string;
  trading_volume: number;
  tgr_holding: number;
  maker_fee: number;
  taker_fee: number;
  next_level: number | null;
  next_level_requirement: number | null;
  next_tgr_requirement: number | null;
  volume_to_next: number | null;
}

/**
 * The caller's tier and progress toward the next one.
 *
 * Volume and holding are read from settled trades and the live TGR balance, so
 * the number shown is the number the fee engine will use.
 */
export function vipInfo(userId: string): VipInfo {
  const tiers = schedule();
  if (tiers.length === 0) throw new Error('no fee schedule is configured');

  const volume = volume30d(userId);
  const holding = availableBalance(userId, 'TGR');
  const resolved = resolveFeeTier(tiers, { volume30d: volume, holding, payInNative: false });

  const ordered = [...tiers].sort((a, b) => a.level - b.level);
  const next = ordered.find((tier) => tier.level > resolved.level) ?? null;

  return {
    current_level: resolved.level,
    level: resolved.level,
    name: resolved.name,
    trading_volume: volume,
    tgr_holding: holding,
    maker_fee: resolved.futuresMaker,
    taker_fee: resolved.futuresTaker,
    next_level: next ? next.level : null,
    next_level_requirement: next ? next.volumeThreshold : null,
    next_tgr_requirement: next ? next.holdingThreshold : null,
    volume_to_next: next ? Math.max(0, next.volumeThreshold - volume) : null,
  };
}
