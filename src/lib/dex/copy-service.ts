/**
 * DEX copy trading.
 *
 * The copy-trading engine mirrors a leader's *CEX* fills; this module mirrors a
 * leader's *TigerSwap* swaps. A follower's own config sizes each mirrored trade
 * through the shared `copyOrder` planner, so a follower is never sized past
 * their maximum and a fixed-amount follower cannot be asked for an amount they
 * did not set. Each leader swap is mirrored at most once per follow (enforced by
 * the unique index on `dex_copy_mirrors`), and a mirror settles as a real swap
 * from the follower's own balance, so nothing is fabricated.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { copyOrder, type CopyConfig } from '@/lib/trading/copy';
import { portfolioSummary, usdPrice } from '@/lib/db/portfolio';
import { executeSwap } from '@/lib/dex/swap-service';
import { DexError } from '@/lib/dex/pool-service';

export interface MirroredSwap {
  followId: string;
  traderId: string;
  leaderSwapId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  leaderAmountIn: number;
  leaderCreatedAt: string;
}

interface FollowRow {
  follow_id: string;
  trader_id: string;
  copy_mode: string;
  fixed_amount: number | null;
  ratio: number | null;
  max_position: number | null;
  leader_user_id: string;
  created_at: string;
}

function activeFollows(followerId: string): FollowRow[] {
  return getDb()
    .prepare(
      `SELECT f.follow_id, f.trader_id, f.copy_mode, f.fixed_amount, f.ratio, f.max_position,
              t.user_id AS leader_user_id, f.created_at
         FROM copy_follows f JOIN copy_traders t ON t.trader_id = f.trader_id
        WHERE f.follower_id = ? AND f.status = 'active'`,
    )
    .all(followerId) as FollowRow[];
}

function configOf(follow: FollowRow): CopyConfig {
  return {
    mode: follow.copy_mode === 'fixed' ? 'fixed' : 'ratio',
    fixedAmount: follow.fixed_amount === null ? undefined : Number(follow.fixed_amount),
    ratio: follow.ratio === null ? undefined : Number(follow.ratio),
    maxPosition: follow.max_position === null ? undefined : Number(follow.max_position),
  };
}

/**
 * The leader swaps a follower's config would mirror, sized and priced.
 *
 * A swap is offered to the planner as a fill whose `leaderEquity` is the leader's
 * live portfolio value — the same basis the CEX mirroring path uses — so a
 * follower copies the leader's trade as the same fraction of their own equity.
 * Only swaps the follower has not already mirrored are returned, so a preview is
 * exactly the work the settle step would do. A swap whose size rounds to nothing
 * is omitted rather than emitted as a zero-size trade.
 */
export function scanCopySwaps(followerId: string, limit = 100): MirroredSwap[] {
  const db = getDb();
  const follows = activeFollows(followerId);
  if (follows.length === 0) return [];

  const followerEquity = portfolioSummary(followerId).totalBalanceUSDT;
  const out: MirroredSwap[] = [];

  for (const follow of follows) {
    const swaps = db
      .prepare(
        `SELECT s.swap_id, s.token_in, s.token_out, s.amount_in, s.amount_out, s.created_at
           FROM dex_swaps s
          WHERE s.user_id = ?
            AND datetime(s.created_at) >= datetime(?)
            AND NOT EXISTS (
              SELECT 1 FROM dex_copy_mirrors m
               WHERE m.follow_id = ? AND m.leader_swap_id = s.swap_id
            )
          ORDER BY s.created_at DESC
          LIMIT ?`,
      )
      .all(follow.leader_user_id, follow.created_at, follow.follow_id, Math.min(Math.max(limit, 1), 500)) as Array<{
      swap_id: string;
      token_in: string;
      token_out: string;
      amount_in: number;
      amount_out: number;
      created_at: string;
    }>;

    const leaderEquity = portfolioSummary(follow.leader_user_id).totalBalanceUSDT;
    for (const swap of swaps) {
      const amountIn = Number(swap.amount_in);
      const amountOut = Number(swap.amount_out);
      if (!(amountIn > 0) || !(amountOut > 0)) continue;
      // The planner works in USD, so the fill is expressed at the input token's
      // USD price; the leader's input is the quantity. A swap whose input token
      // has no price cannot be sized safely and is skipped rather than guessed.
      const inPrice = usdPrice(swap.token_in);
      if (inPrice === null || !(inPrice > 0)) continue;
      const order = copyOrder(
        { symbol: `${swap.token_in}/${swap.token_out}`, side: 'buy', price: inPrice, quantity: amountIn, leaderEquity },
        configOf(follow),
        followerEquity,
      );
      if (!order || 'error' in order) continue;
      // The planner returns a notional in USD; convert it back to input units.
      const mirroredAmountIn = order.notional / inPrice;
      if (!(mirroredAmountIn > 0)) continue;
      out.push({
        followId: follow.follow_id,
        traderId: follow.trader_id,
        leaderSwapId: swap.swap_id,
        tokenIn: swap.token_in,
        tokenOut: swap.token_out,
        amountIn: mirroredAmountIn,
        leaderAmountIn: amountIn,
        leaderCreatedAt: swap.created_at,
      });
    }
  }

  return out.slice(0, Math.min(Math.max(limit, 1), 500));
}

export interface CopyMirrorResult {
  followId: string;
  leaderSwapId: string;
  status: 'mirrored' | 'skipped';
  swapId?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: number;
  amountOut?: number;
  reason?: string;
}

/**
 * Settle every pending leader swap the follower's config mirrors.
 *
 * Each mirror is a real swap from the follower's own balance; a swap the follower
 * cannot fund (or that has no route) is skipped and reported rather than aborting
 * the batch, so one unaffordable mirror does not block the rest. The mirror row
 * is written in the same step as the swap, so a crash between them cannot cause a
 * double mirror.
 */
export function mirrorCopySwaps(followerId: string, limit = 25): CopyMirrorResult[] {
  const planned = scanCopySwaps(followerId, limit);
  const results: CopyMirrorResult[] = [];

  for (const entry of planned) {
    try {
      const swap = executeSwap({
        userId: followerId,
        tokenIn: entry.tokenIn,
        tokenOut: entry.tokenOut,
        amountIn: entry.amountIn,
      });
      getDb()
        .prepare(
          `INSERT INTO dex_copy_mirrors (mirror_id, follower_id, follow_id, leader_swap_id, swap_id, amount_in, amount_out)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(generateId(), followerId, entry.followId, entry.leaderSwapId, swap.swapId, swap.amountIn, swap.amountOut);
      results.push({
        followId: entry.followId,
        leaderSwapId: entry.leaderSwapId,
        status: 'mirrored',
        swapId: swap.swapId,
        tokenIn: swap.tokenIn,
        tokenOut: swap.tokenOut,
        amountIn: swap.amountIn,
        amountOut: swap.amountOut,
      });
    } catch (error) {
      const reason = error instanceof DexError ? error.code : error instanceof Error ? error.message : 'mirror failed';
      results.push({ followId: entry.followId, leaderSwapId: entry.leaderSwapId, status: 'skipped', reason });
    }
  }

  return results;
}

/** A follower's settled DEX copy mirrors, newest first. */
export function copyMirrors(followerId: string, limit = 100): Array<Record<string, unknown>> {
  return getDb()
    .prepare(
      `SELECT m.mirror_id, m.follow_id, m.leader_swap_id, m.swap_id, m.amount_in, m.amount_out, m.created_at,
              s.token_in, s.token_out, s.amount_out AS settled_out
         FROM dex_copy_mirrors m LEFT JOIN dex_swaps s ON s.swap_id = m.swap_id
        WHERE m.follower_id = ? ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(followerId, Math.min(Math.max(limit, 1), 500)) as Array<Record<string, unknown>>;
}

/**
 * Settle pending DEX mirrors for every follower with an active follow.
 *
 * The settlement cycle calls this so a follower's TigerSwap copies settle on the
 * same schedule as the CEX copies `runCopySweep` settles, rather than only when
 * the follower opens the page. One follower's failure cannot stop the sweep, so
 * each is mirrored in isolation and its error recorded.
 */
export function runDexCopySweep(limitPerFollower = 25): Array<CopyMirrorResult & { followerId: string; error?: string }> {
  const followers = getDb()
    .prepare("SELECT DISTINCT follower_id FROM copy_follows WHERE status = 'active'")
    .all() as Array<{ follower_id: string }>;

  const out: Array<CopyMirrorResult & { followerId: string; error?: string }> = [];
  for (const { follower_id: followerId } of followers) {
    try {
      for (const result of mirrorCopySwaps(followerId, limitPerFollower)) {
        out.push({ ...result, followerId });
      }
    } catch (error) {
      out.push({
        followerId,
        followId: '',
        leaderSwapId: '',
        status: 'skipped',
        reason: 'SWEEP_FAILED',
        error: error instanceof Error ? error.message : 'sweep failed',
      });
    }
  }
  return out;
}
