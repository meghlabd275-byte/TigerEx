/**
 * TigerSwap liquidity-provider analytics, read from the venue's own rows.
 *
 * The pool-level figures come from the pool's trailing 24-hour fees and its
 * value, and the position-level figures scale those by the provider's share of
 * the pool's LP supply. Nothing is estimated from an external feed: a pool with
 * no settled swaps in the window reports a zero fee rate rather than a guess.
 */

import { getDb } from '@/lib/db';
import { parseStringArray, parseObject, type DexPoolRow } from '@/lib/dex/pool-service';
import {
  poolFeeApr,
  aprToApy,
  positionShare,
  positionFeesUsd,
  positionValueUsd,
  divergenceLoss,
} from '@/lib/dex/liquidity-analytics';

export {
  positionShare,
  poolFeeApr,
  aprToApy,
  positionFeesUsd,
  positionValueUsd,
  divergenceLoss,
};

export interface PoolAnalytics {
  poolId: string;
  kind: string;
  tokens: string[];
  tvlUsd: number;
  volume24hUsd: number;
  fee24hUsd: number;
  /**
   * Annualised fee return as a fraction (0.42 = 42%), or null when the pool has
   * no priceable value so no rate can be derived. A null is reported rather than
   * a zero, because a zero would read as "this pool earns nothing" when the real
   * cause is that its tokens cannot be valued.
   */
  feeApr: number | null;
  /** The same return compounded continuously, or null alongside the APR. */
  feeApy: number | null;
}

/** The live fee analytics for every pool, from its own rows. */
export function poolAnalytics(): PoolAnalytics[] {
  const rows = getDb().prepare('SELECT * FROM dex_pools ORDER BY created_at DESC').all() as DexPoolRow[];
  return rows.map((row) => {
    const tvl = Number(row.tvl_usd) || 0;
    const fee = Number(row.fee_24h_usd) || 0;
    const apr = tvl > 0 ? poolFeeApr(fee, tvl) : null;
    return {
      poolId: row.pool_id,
      kind: row.kind,
      tokens: parseStringArray(row.tokens, 'tokens'),
      tvlUsd: tvl,
      volume24hUsd: Number(row.volume_24h_usd) || 0,
      fee24hUsd: fee,
      feeApr: apr,
      feeApy: apr === null ? null : aprToApy(apr),
    };
  });
}

/** The analytics for one pool, or null when the pool does not exist. */
export function poolAnalyticsFor(poolId: string): PoolAnalytics | null {
  return poolAnalytics().find((entry) => entry.poolId === poolId) ?? null;
}

export interface PositionAnalytics {
  share: number;
  valueUsd: number;
  fees24hUsd: number;
  /** The pool's fee APR, or null when the pool cannot be valued. */
  feeApr: number | null;
  feeApy: number | null;
  /** Divergence loss for a constant-product position, or null elsewhere. */
  divergenceLoss: number | null;
  /** The current price over the entry price, or null elsewhere. */
  priceRatio: number | null;
}

/**
 * The analytics for one provider's position in a pool.
 *
 * Divergence loss is only defined for a constant-product pool, so it is reported
 * for a V2 position and null for every other kind; the fee return is reported
 * for all of them. The entry price is taken from the amounts recorded when the
 * position was opened, so the loss is measured against the provider's own entry
 * rather than a fixed baseline. A pool whose tokens cannot be valued reports a
 * null rate rather than a misleading zero.
 */
export function positionAnalytics(
  position: { liquidity: number; amount0: number; amount1: number },
  pool: DexPoolRow,
): PositionAnalytics {
  const totalSupply = Number(pool.total_supply) || 0;
  const liquidity = Number(position.liquidity) || 0;
  const tvl = Number(pool.tvl_usd) || 0;
  const fee24h = Number(pool.fee_24h_usd) || 0;
  const apr = tvl > 0 ? poolFeeApr(fee24h, tvl) : null;

  let il: number | null = null;
  let ratio: number | null = null;
  if (pool.kind === 'v2') {
    const tokens = parseStringArray(pool.tokens, 'tokens');
    const reserves = parseObject(pool.reserves, 'reserves');
    const entry0 = Number(position.amount0) || 0;
    const entry1 = Number(position.amount1) || 0;
    const now0 = Number(reserves[tokens[0]]) || 0;
    const now1 = Number(reserves[tokens[1]] ?? 0) || 0;
    if (entry0 > 0 && entry1 > 0 && now0 > 0 && now1 > 0) {
      // The marginal price of token0 in token1 is the reserve ratio, so the
      // price ratio since entry is the current reserve ratio over the entry one.
      ratio = (now1 * entry0) / (now0 * entry1);
      il = divergenceLoss(ratio);
    }
  }

  return {
    share: positionShare(liquidity, totalSupply),
    valueUsd: positionValueUsd(liquidity, totalSupply, tvl),
    fees24hUsd: positionFeesUsd(liquidity, totalSupply, fee24h, 1),
    feeApr: apr,
    feeApy: apr === null ? null : aprToApy(apr),
    divergenceLoss: il,
    priceRatio: ratio,
  };
}
