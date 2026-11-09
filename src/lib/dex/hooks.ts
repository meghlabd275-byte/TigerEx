/**
 * TigerSwap V4 hooks.
 *
 * A hook is a point at which a pool can run its own logic before or after a
 * swap. TigerSwap implements four, all locally: a dynamic fee that widens with
 * volatility, an on-chain limit order that fires when the pool's own price
 * crosses, a TWAMM that executes a large order as many small slices, and an
 * anti-MEV hook that refuses a swap whose price was moved against it in the same
 * block.
 *
 * The engine here is the decision core. It is pure: given a pool's state and a
 * swap it returns the fee to charge, whether to fire, how much to execute and
 * whether to reject. The settlement path applies the result.
 */

import { AmmError, requirePositive, requireFee } from '@/lib/dex/amm';

export type HookKind = 'dynamicFee' | 'limitOrder' | 'twamm' | 'antiMev';

export interface DynamicFeeConfig {
  /** The fee when volatility is at or below the baseline. */
  baseFee: number;
  /** The highest fee the hook will charge. */
  maxFee: number;
  /** Volatility at which the fee reaches maxFee. */
  volatilityCeiling: number;
}

/**
 * A fee that rises with realised volatility.
 *
 * A pool with a fixed fee is picked off when the price is moving: arbitrageurs
 * trade against stale liquidity at the low fee. Widening the fee as volatility
 * rises compensates the liquidity providers for exactly the risk they are
 * carrying, and it decays back to the base when the market is calm.
 */
export function dynamicFee(config: DynamicFeeConfig, volatility: number): number {
  const base = requireFee(config.baseFee);
  const max = requireFee(config.maxFee);
  if (max < base) {
    throw new AmmError('INVALID_FEE', 'maxFee must be at least baseFee');
  }
  const ceiling = requirePositive(config.volatilityCeiling, 'volatilityCeiling');
  const vol = Number(volatility);
  if (!Number.isFinite(vol) || vol < 0) {
    throw new AmmError('INVALID_VOLATILITY', 'volatility must be a non-negative finite number');
  }
  if (vol >= ceiling) return max;
  return base + (max - base) * (vol / ceiling);
}

export interface LimitOrderState {
  orderId: string;
  side: 'buy' | 'sell';
  /** The price at which the order fires. */
  triggerPrice: number;
  /** Input amount the order will trade. */
  amountIn: number;
  /** Whether it has already fired. */
  filled: boolean;
}

export interface LimitDecision {
  fire: boolean;
  reason: string;
}

/**
 * Whether an on-chain limit order should fire at the current pool price.
 *
 * A buy fires when the price has fallen to the trigger — the buyer wanted to buy
 * at or below it. A sell fires when the price has risen to the trigger. The
 * boundary is inclusive so an order at exactly the trigger price executes.
 */
export function shouldFireLimit(order: LimitOrderState, currentPrice: number): LimitDecision {
  if (order.filled) return { fire: false, reason: 'order already filled' };
  const price = requirePositive(currentPrice, 'currentPrice');
  const trigger = requirePositive(order.triggerPrice, 'triggerPrice');
  if (order.side === 'buy') {
    return price <= trigger
      ? { fire: true, reason: `price ${price} reached buy trigger ${trigger}` }
      : { fire: false, reason: `price ${price} is above buy trigger ${trigger}` };
  }
  return price >= trigger
    ? { fire: true, reason: `price ${price} reached sell trigger ${trigger}` }
    : { fire: false, reason: `price ${price} is below sell trigger ${trigger}` };
}

export interface TwammState {
  /** Total input still to execute. */
  remainingIn: number;
  /** Total time the order should take, in seconds. */
  durationSeconds: number;
  /** When execution started, in Unix seconds. */
  startedAt: number;
  /** The last time a slice ran. */
  lastExecutedAt: number;
}

/**
 * The size of the next TWAMM slice.
 *
 * The order is spread evenly across its duration: each slice is the fraction of
 * the remaining amount that the elapsed interval represents. Executing on a
 * schedule rather than in one trade keeps the pool's price from being driven by
 * the order itself, which is the entire point of a time-weighted execution.
 */
export function twammSlice(state: TwammState, now: number): number {
  const remaining = Number(state.remainingIn);
  if (!Number.isFinite(remaining) || remaining < 0) {
    throw new AmmError('INVALID_STATE', 'remainingIn must be a non-negative finite number');
  }
  if (remaining === 0) return 0;
  const duration = requirePositive(state.durationSeconds, 'durationSeconds');
  const elapsed = Number(now) - Number(state.lastExecutedAt);
  if (!Number.isFinite(elapsed)) {
    throw new AmmError('INVALID_TIME', 'now must be a finite number');
  }
  if (elapsed <= 0) return 0;

  const endAt = Number(state.startedAt) + duration;
  if (now >= endAt) return remaining;
  return (remaining * elapsed) / (endAt - Number(state.lastExecutedAt));
}

export interface AntiMevState {
  /** Price observed at the start of the block, before any swap. */
  blockOpenPrice: number;
  /** The current pool price. */
  currentPrice: number;
  /** Maximum adverse move tolerated, as a fraction. */
  tolerance: number;
}

export interface AntiMevDecision {
  allowed: boolean;
  /** The adverse move observed, as a fraction. */
  move: number;
  reason: string;
}

/**
 * Refuse a swap that would execute after the price was pushed against it.
 *
 * The anti-MEV hook compares the price at the block's open with the price now.
 * If an attacker front-ran the victim the price has already moved, so the
 * victim's swap would execute at the worse price. Rejecting it costs the victim
 * the transaction but saves the far larger loss, and it removes the profit that
 * made the sandwich worth attempting.
 */
export function antiMevCheck(state: AntiMevState, side: 'buy' | 'sell'): AntiMevDecision {
  const open = requirePositive(state.blockOpenPrice, 'blockOpenPrice');
  const current = requirePositive(state.currentPrice, 'currentPrice');
  const tolerance = Number(state.tolerance);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 1) {
    throw new AmmError('INVALID_TOLERANCE', 'tolerance must be a fraction in [0, 1)');
  }

  // For a buyer, a price that rose is adverse; for a seller, a price that fell.
  const rawMove = (current - open) / open;
  const adverse = side === 'buy' ? rawMove : -rawMove;
  const move = Math.max(0, adverse);

  return move > tolerance
    ? { allowed: false, move, reason: `price moved ${(move * 100).toFixed(3)}% against the order` }
    : { allowed: true, move, reason: 'price move is within tolerance' };
}

export interface HookFeeResult {
  fee: number;
  applied: HookKind[];
}

/**
 * Compose the hooks that modify a swap's fee.
 *
 * Only the dynamic-fee hook changes the fee; the others gate or shape the
 * order. Returning the applied set makes the path auditable — a swap's receipt
 * can record exactly which hooks touched it.
 */
export function composeHooks(
  swap: { volatility: number; side: 'buy' | 'sell'; blockOpenPrice: number; currentPrice: number },
  config: { dynamicFee?: DynamicFeeConfig; antiMevTolerance?: number; baseFee: number },
): HookFeeResult {
  const applied: HookKind[] = [];
  let fee = requireFee(config.baseFee);

  if (config.dynamicFee) {
    fee = dynamicFee(config.dynamicFee, swap.volatility);
    applied.push('dynamicFee');
  }

  if (config.antiMevTolerance !== undefined) {
    const decision = antiMevCheck(
      { blockOpenPrice: swap.blockOpenPrice, currentPrice: swap.currentPrice, tolerance: config.antiMevTolerance },
      swap.side,
    );
    if (!decision.allowed) {
      throw new AmmError('MEV_BLOCKED', decision.reason);
    }
    applied.push('antiMev');
  }

  return { fee, applied };
}
