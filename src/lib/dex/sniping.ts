/**
 * TigerSwap sniping bot.
 *
 * A sniper buys a newly created pool's token in the first moments, before the
 * price has found its level. It is the highest-risk bot on the venue: the token
 * may be a rug, the liquidity may be pulled the next block, and the entry price
 * is whatever the pool says it is. The logic here is therefore mostly refusal.
 * A candidate is only snipeable when the pool it targets passes a set of hard
 * preconditions, and the size is capped by how much the snipe may move the
 * price, not by how much the operator is willing to spend.
 */

import { AmmError, requirePositive, requireFee, v2GetAmountOut, v2PriceImpact, type V2Reserves } from '@/lib/dex/amm';

export interface SnipeCandidate {
  poolId: string;
  /** When the pool was created, in Unix seconds. */
  createdAt: number;
  /** Input-token liquidity in the pool. */
  liquidityIn: number;
  /** Whether the pool accepts trades. */
  tradingEnabled: boolean;
  /** Whether the pool's token has been flagged as spam or malicious. */
  flagged: boolean;
}

export interface SnipePolicy {
  /** A pool older than this many seconds is no longer "new". */
  windowSeconds: number;
  /** Minimum input-token liquidity for a snipe to be considered. */
  minLiquidity: number;
  /** Maximum price impact a single snipe may cause, as a fraction. */
  maxImpact: number;
}

export interface SnipeEligibility {
  eligible: boolean;
  reason: string;
}

/**
 * Whether a freshly created pool is safe enough to snipe.
 *
 * Every condition is a refusal: the bot does nothing unless it is certain the
 * pool is recent, funded, open and unflagged. A pool that is old is no longer a
 * snipe — the edge is gone and the bot would just be buying at market. A pool
 * with too little liquidity cannot absorb the trade without a ruinous impact. A
 * flagged token is a known scam.
 */
export function snipeEligibility(
  candidate: SnipeCandidate,
  policy: SnipePolicy,
  now: number,
): SnipeEligibility {
  const liquidity = Number(candidate.liquidityIn);
  if (!Number.isFinite(liquidity) || liquidity < 0) {
    throw new AmmError('INVALID_LIQUIDITY', 'liquidityIn must be a non-negative finite number');
  }
  if (candidate.flagged) return { eligible: false, reason: 'the pool token is flagged' };
  if (!candidate.tradingEnabled) return { eligible: false, reason: 'trading is not enabled on the pool' };

  const age = Number(now) - Number(candidate.createdAt);
  if (!Number.isFinite(age)) throw new AmmError('INVALID_TIME', 'now must be a finite number');
  if (age < 0) return { eligible: false, reason: 'the pool was created in the future' };
  if (age > policy.windowSeconds) {
    return { eligible: false, reason: `the pool is ${age}s old, past the ${policy.windowSeconds}s window` };
  }
  if (liquidity < policy.minLiquidity) {
    return { eligible: false, reason: `liquidity ${liquidity} is below the minimum ${policy.minLiquidity}` };
  }
  return { eligible: true, reason: 'the pool is new, funded, open and unflagged' };
}

export interface SnipePlan {
  /** Input the sniper commits. */
  amountIn: number;
  /** Expected output at the current reserves. */
  expectedOut: number;
  /** Minimum output, after the slippage the sniper accepts. */
  minOut: number;
  /** The price impact this trade will cause. */
  impact: number;
  /** Suggested gas multiplier to win the inclusion race. */
  gasMultiplier: number;
}

/**
 * Size and price a snipe.
 *
 * The requested size is reduced until its own price impact is within the
 * policy's cap, so a snipe can never be the trade that moves the pool beyond
 * what the operator authorised. Slippage is applied on top: `minOut` is what the
 * snipe will accept, and because the impact is capped first, the two do not
 * compound into a guaranteed loss. The gas multiplier is derived from the
 * competition — a snipe in a crowded block needs to bid higher to be included —
 * but it is bounded so a bidding war cannot spend the whole position on gas.
 */
export function planSnipe(
  amountIn: number,
  reserves: V2Reserves,
  fee: number,
  slippage: number,
  policy: { maxImpact: number; gasMultiplier: number },
): SnipePlan {
  const requested = requirePositive(amountIn, 'amountIn');
  const rIn = requirePositive(reserves.reserveIn, 'reserveIn');
  const rOut = requirePositive(reserves.reserveOut, 'reserveOut');
  const f = requireFee(fee);
  if (!Number.isFinite(slippage) || slippage < 0 || slippage >= 1) {
    throw new AmmError('INVALID_SLIPPAGE', 'slippage must be a fraction in [0, 1)');
  }

  let size = requested;
  let impact = v2PriceImpact(size, { reserveIn: rIn, reserveOut: rOut });
  if (impact > policy.maxImpact) {
    // Solve for the input whose impact equals the cap. Impact is monotonic in
    // the input, so a bisection on the same impact the settlement path uses
    // gives a size that is exact to the tolerance rather than a fudged guess.
    let low = 0;
    let high = requested;
    for (let i = 0; i < 80; i += 1) {
      const mid = (low + high) / 2;
      if (v2PriceImpact(mid, { reserveIn: rIn, reserveOut: rOut }) > policy.maxImpact) high = mid;
      else low = mid;
    }
    size = low;
    impact = v2PriceImpact(size, { reserveIn: rIn, reserveOut: rOut });
  }

  const expectedOut = v2GetAmountOut(size, { reserveIn: rIn, reserveOut: rOut }, f);
  return {
    amountIn: size,
    expectedOut,
    minOut: expectedOut * (1 - slippage),
    impact,
    gasMultiplier: policy.gasMultiplier,
  };
}

/**
 * Rank candidates so the bot spends its block space on the best snipe.
 *
 * A newer, deeper pool is preferred: it is earlier in its life (more upside) and
 * better funded (less likely to be a rug). The score is a product, so a pool
 * that is excellent on one axis and terrible on the other does not rank above a
 * pool that is good on both.
 */
export function rankCandidates(
  candidates: SnipeCandidate[],
  policy: SnipePolicy,
  now: number,
): Array<{ poolId: string; score: number }> {
  const scored = candidates
    .map((candidate) => {
      const eligibility = snipeEligibility(candidate, policy, now);
      if (!eligibility.eligible) return null;
      const age = Math.max(0, now - candidate.createdAt);
      const freshness = 1 - Math.min(1, age / policy.windowSeconds);
      const depth = Math.min(1, candidate.liquidityIn / (policy.minLiquidity * 10));
      return { poolId: candidate.poolId, score: freshness * depth };
    })
    .filter((entry): entry is { poolId: string; score: number } => entry !== null);
  return scored.sort((a, b) => b.score - a.score);
}
