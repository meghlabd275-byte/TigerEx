/**
 * TigerSwap zap settlement.
 *
 * A zap deposits a single token into a two-token pool in one action: part of the
 * input is swapped for the other side, then both are deposited. The split is
 * solved by `zap.ts` against the pool's real reserves and the router's real
 * quote, so the deposit is balanced rather than approximated, and the leftover
 * dust stays with the user instead of being silently taken.
 *
 * A zap-out is the reverse: the LP position is burned, one side is swapped back
 * into the requested token, and the user receives a single token.
 */

import { availableBalance } from '@/lib/db/ledger';
import { DexError, loadPool, parseObject, parseStringArray, assertDexOpen } from '@/lib/dex/pool-service';
import { zapSplitV2, zapSplit, type ZapInPlan } from '@/lib/dex/zap';
import { quoteSwap, executeSwap } from '@/lib/dex/swap-service';
import { addLiquidity, removeLiquidity } from '@/lib/dex/liquidity-service';

export interface ZapInRequest {
  userId: string;
  poolId: string;
  /** The single token the user is depositing. */
  tokenIn: string;
  /** Total amount of `tokenIn` to spend. */
  amountIn: number;
  slippage?: number | string;
  /** Optional lock for the resulting LP position. */
  lockedUntil?: string;
}

export interface ZapInResult {
  poolId: string;
  positionId: string;
  /** The swap leg. */
  swappedIn: number;
  swappedOut: number;
  /** The liquidity leg. */
  deposited: Record<string, number>;
  liquidity: number;
  dust: number;
}

/**
 * Split a single-asset deposit into a swap and a deposit, then execute both.
 *
 * The plan is computed from the pool's own reserves: for a constant-product pool
 * the closed-form root is used, and for every other shape the router's quote is
 * bisected. In both cases the amounts the settlement path receives are the ones
 * the plan produced, so the balance condition holds after settlement too.
 */
export function zapIn(request: ZapInRequest): ZapInResult {
  assertDexOpen('dex');
  const row = loadPool(request.poolId);
  const tokens = parseStringArray(row.tokens, 'tokens');
  if (tokens.length !== 2) {
    throw new DexError('INVALID_POOL', 'a zap requires a two-token pool', 400);
  }
  const tokenIn = String(request.tokenIn).trim().toUpperCase();
  if (!tokens.includes(tokenIn)) {
    throw new DexError('INVALID_TOKEN', `${tokenIn} is not in this pool`, 400);
  }
  const tokenOut = tokens.find((token) => token !== tokenIn) as string;

  const amount = Number(request.amountIn);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DexError('INVALID_AMOUNT', 'amountIn must be a positive number', 400);
  }
  if (availableBalance(request.userId, tokenIn) < amount) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${tokenIn} balance`, 400);
  }

  const reserves = parseObject(row.reserves, 'reserves');
  const plan = planZapIn(row.kind, Number(row.fee), amount, tokenIn, tokenOut, reserves);

  // Swap leg. The plan's swap amount is the input; settlement quotes internally,
  // so a thin pool fails here rather than after the deposit has been sized.
  let swappedOut = 0;
  if (plan.swapIn > 0) {
    const result = executeSwap({ userId: request.userId, tokenIn, tokenOut, amountIn: plan.swapIn, slippage: request.slippage });
    swappedOut = result.amountOut;
    if (swappedOut <= 0) {
      throw new DexError('ZAP_FAILED', 'the swap leg produced nothing', 409);
    }
  }

  // Deposit leg. The residual input plus whatever the swap produced is the
  // deposit, which the liquidity service takes proportionally.
  const deposited: Record<string, number> = { [tokenIn]: plan.depositIn };
  if (swappedOut > 0) deposited[tokenOut] = swappedOut;

  const result = addLiquidity({
    userId: request.userId,
    poolId: request.poolId,
    amounts: deposited,
    lockedUntil: request.lockedUntil,
  });

  // Anything the proportional deposit did not take stays with the user; report
  // it rather than pretending the whole input was used.
  const leftoverIn = deposited[tokenIn] - (result.amounts[tokenIn] ?? 0);
  const leftoverOut = (deposited[tokenOut] ?? 0) - (result.amounts[tokenOut] ?? 0);

  return {
    poolId: request.poolId,
    positionId: result.positionId,
    swappedIn: plan.swapIn,
    swappedOut,
    deposited: result.amounts,
    liquidity: result.liquidity,
    dust: Math.max(0, leftoverIn) + Math.max(0, leftoverOut),
  };
}

/** Compute the swap/deposit split for the pool's shape. */
function planZapIn(
  kind: string,
  fee: number,
  amount: number,
  tokenIn: string,
  tokenOut: string,
  reserves: Record<string, number>,
): ZapInPlan {
  const reserveIn = Number(reserves[tokenIn]);
  const reserveOut = Number(reserves[tokenOut]);
  if (!Number.isFinite(reserveIn) || reserveIn <= 0 || !Number.isFinite(reserveOut) || reserveOut <= 0) {
    throw new DexError('EMPTY_POOL', 'the pool has no reserves to zap into', 409);
  }

  if (kind === 'v2') {
    // The pool's own fee is the only input the constant-product solver needs.
    return zapSplitV2(amount, { reserveIn, reserveOut }, fee);
  }

  // For stable, weighted and concentrated pools the balance condition is solved
  // against the router's real quote, which already accounts for the pool's
  // pricing curve, so the split matches what settlement will deliver.
  const quoteOut = (swapIn: number): number => {
    try {
      return quoteSwap({ tokenIn, tokenOut, amountIn: swapIn }).amountOut;
    } catch {
      return 0;
    }
  };
  return zapSplit(amount, reserveIn, reserveOut, quoteOut);
}

export interface ZapOutRequest {
  userId: string;
  poolId: string;
  /** LP tokens to redeem. */
  liquidity: number;
  /** Which pool token to receive; the other side is swapped into it. */
  tokenOut: string;
  slippage?: number | string;
}

export interface ZapOutResult {
  poolId: string;
  burned: number;
  received: number;
  tokenOut: string;
}

/**
 * Redeem an LP position into a single token.
 *
 * The position is burned first and both sides are returned, then the side the
 * user does not want is swapped into the side they do. Doing the burn first
 * means the swap trades against the pool's post-burn reserves, so the price the
 * user gets is the one that actually exists.
 */
export function zapOut(request: ZapOutRequest): ZapOutResult {
  assertDexOpen('dex');
  const row = loadPool(request.poolId);
  const tokens = parseStringArray(row.tokens, 'tokens');
  if (tokens.length !== 2) throw new DexError('INVALID_POOL', 'a zap requires a two-token pool', 400);
  const tokenOut = String(request.tokenOut).trim().toUpperCase();
  if (!tokens.includes(tokenOut)) throw new DexError('INVALID_TOKEN', `${tokenOut} is not in this pool`, 400);

  const burn = Number(request.liquidity);
  if (!Number.isFinite(burn) || burn <= 0) throw new DexError('INVALID_AMOUNT', 'liquidity must be positive', 400);

  const removed = removeLiquidity({ userId: request.userId, poolId: request.poolId, liquidity: burn });
  const other = tokens.find((token) => token !== tokenOut) as string;
  const otherAmount = other === tokens[0] ? removed.amount0 : removed.amount1;
  const wantedAmount = tokenOut === tokens[0] ? removed.amount0 : removed.amount1;

  let received = wantedAmount;
  if (otherAmount > 0) {
    const swapped = executeSwap({
      userId: request.userId,
      tokenIn: other,
      tokenOut,
      amountIn: otherAmount,
      slippage: request.slippage,
    });
    received += swapped.amountOut;
  }

  return { poolId: request.poolId, burned: burn, received, tokenOut };
}
