/**
 * TigerSwap advanced order logic: on-chain limit orders, DCA and TWAP.
 *
 * These are pure scheduling and trigger rules. A limit order rests off-book and
 * is filled by the settlement engine when the pool price crosses its trigger;
 * DCA and TWAP slice a parent order into child orders released on a schedule.
 * No external scheduler or oracle is consulted.
 */

import { AmmError } from '@/lib/dex/amm';

export type LimitSide = 'buy' | 'sell';
export type LimitStatus = 'open' | 'filled' | 'cancelled';

export interface LimitOrderInput {
  poolId: string;
  side: LimitSide;
  tokenIn: string;
  tokenOut: string;
  /** Amount of the input token the trader is willing to spend. */
  amountIn: number;
  /** Price of the output token in input-token units at which to trigger. */
  limitPrice: number;
}

export interface LimitOrder extends LimitOrderInput {
  orderId: string;
  status: LimitStatus;
  /** Amount actually filled once the trigger fires. */
  filledAmountOut: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Whether a limit order should fire at the current pool price.
 *
 * A buy triggers when the market price falls to or below the limit (buying
 * cheap); a sell triggers when it rises to or above the limit. The comparison
 * is inclusive so an order placed exactly at the current price is executable.
 */
export function limitShouldTrigger(order: Pick<LimitOrder, 'side' | 'limitPrice'>, marketPrice: number): boolean {
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    throw new AmmError('INVALID_PRICE', 'marketPrice must be a positive finite number');
  }
  if (!Number.isFinite(order.limitPrice) || order.limitPrice <= 0) {
    throw new AmmError('INVALID_PRICE', 'limitPrice must be a positive finite number');
  }
  return order.side === 'buy' ? marketPrice <= order.limitPrice : marketPrice >= order.limitPrice;
}

/** Validate and normalize a limit order request. */
export function validateLimitOrder(input: LimitOrderInput): LimitOrderInput {
  if (!input.poolId) throw new AmmError('INVALID_POOL', 'poolId is required');
  if (input.side !== 'buy' && input.side !== 'sell') {
    throw new AmmError('INVALID_SIDE', 'side must be buy or sell');
  }
  if (!input.tokenIn || !input.tokenOut || input.tokenIn === input.tokenOut) {
    throw new AmmError('INVALID_PAIR', 'tokenIn and tokenOut must be distinct');
  }
  if (!Number.isFinite(input.amountIn) || input.amountIn <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'amountIn must be positive');
  }
  if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0) {
    throw new AmmError('INVALID_PRICE', 'limitPrice must be positive');
  }
  return { ...input };
}

export type DcaFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

const FREQUENCY_MS: Record<DcaFrequency, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function frequencyMs(frequency: DcaFrequency): number {
  const ms = FREQUENCY_MS[frequency];
  if (!ms) throw new AmmError('INVALID_FREQUENCY', `unknown frequency ${frequency}`);
  return ms;
}

export interface DcaPlan {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  /** Amount of the input token spent on each slice. */
  amountPerSlice: number;
  frequency: DcaFrequency;
  /** Total number of slices; zero means run until cancelled. */
  totalSlices: number;
  startAt: number;
}

/** The release times of every slice of a DCA plan. */
export function dcaSchedule(plan: DcaPlan, from = plan.startAt): number[] {
  if (!Number.isFinite(plan.amountPerSlice) || plan.amountPerSlice <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'amountPerSlice must be positive');
  }
  const interval = frequencyMs(plan.frequency);
  if (!Number.isInteger(plan.totalSlices) || plan.totalSlices < 0) {
    throw new AmmError('INVALID_SLICES', 'totalSlices must be a non-negative integer');
  }
  if (!Number.isFinite(plan.startAt) || plan.startAt <= 0) {
    throw new AmmError('INVALID_TIME', 'startAt must be a positive timestamp');
  }
  const times: number[] = [];
  const count = plan.totalSlices === 0 ? 0 : plan.totalSlices;
  for (let i = 0; i < count; i += 1) {
    times.push(plan.startAt + i * interval);
  }
  return times.filter((t) => t >= from);
}

/** Number of slices due between two timestamps (inclusive of the start). */
export function dcaSlicesDue(plan: DcaPlan, now: number): number {
  if (now < plan.startAt) return 0;
  const interval = frequencyMs(plan.frequency);
  const elapsed = Math.floor((now - plan.startAt) / interval) + 1;
  if (plan.totalSlices === 0) return elapsed;
  return Math.min(elapsed, plan.totalSlices);
}

export interface TwapPlan {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  /** Total amount of the input token to work over the horizon. */
  totalAmountIn: number;
  /** Number of child orders. */
  slices: number;
  /** Spacing between child orders. */
  intervalMs: number;
  startAt: number;
}

export interface TwapChild {
  index: number;
  releaseAt: number;
  amountIn: number;
}

/**
 * Split a TWAP parent into equal child orders.
 *
 * The remainder of an indivisible total is added to the final child so the
 * children sum exactly to `totalAmountIn`; the engine must never work less than
 * the requested size because of a rounding drift.
 */
export function twapChildren(plan: TwapPlan): TwapChild[] {
  if (!Number.isFinite(plan.totalAmountIn) || plan.totalAmountIn <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'totalAmountIn must be positive');
  }
  if (!Number.isInteger(plan.slices) || plan.slices < 1) {
    throw new AmmError('INVALID_SLICES', 'slices must be a positive integer');
  }
  if (!Number.isFinite(plan.intervalMs) || plan.intervalMs <= 0) {
    throw new AmmError('INVALID_INTERVAL', 'intervalMs must be positive');
  }
  if (!Number.isFinite(plan.startAt) || plan.startAt <= 0) {
    throw new AmmError('INVALID_TIME', 'startAt must be a positive timestamp');
  }
  const per = plan.totalAmountIn / plan.slices;
  const children: TwapChild[] = [];
  let allocated = 0;
  for (let i = 0; i < plan.slices; i += 1) {
    const amount = i === plan.slices - 1 ? plan.totalAmountIn - allocated : per;
    allocated += amount;
    children.push({ index: i, releaseAt: plan.startAt + i * plan.intervalMs, amountIn: amount });
  }
  return children;
}

/** Average execution price across the child orders of a TWAP. */
export function twapAveragePrice(children: Array<{ amountIn: number; amountOut: number }>): number {
  let totalIn = 0;
  let totalOut = 0;
  for (const child of children) {
    if (!Number.isFinite(child.amountIn) || child.amountIn <= 0) {
      throw new AmmError('INVALID_AMOUNT', 'child amountIn must be positive');
    }
    if (!Number.isFinite(child.amountOut) || child.amountOut < 0) {
      throw new AmmError('INVALID_AMOUNT', 'child amountOut must not be negative');
    }
    totalIn += child.amountIn;
    totalOut += child.amountOut;
  }
  if (totalIn === 0) throw new AmmError('NO_CHILDREN', 'at least one child order is required');
  return totalOut / totalIn;
}

/**
 * TWAMM slice sizing for a pool over a horizon.
 *
 * A time-weighted average market maker releases `totalAmount / (horizon /
 * interval)` per interval, the same arithmetic as TWAP but driven by the pool's
 * continuous execution rather than discrete child orders.
 */
export function twammSliceAmount(totalAmountIn: number, horizonMs: number, intervalMs: number): number {
  if (!Number.isFinite(totalAmountIn) || totalAmountIn <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'totalAmountIn must be positive');
  }
  if (!Number.isFinite(horizonMs) || horizonMs <= 0) {
    throw new AmmError('INVALID_HORIZON', 'horizonMs must be positive');
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new AmmError('INVALID_INTERVAL', 'intervalMs must be positive');
  }
  if (intervalMs > horizonMs) {
    throw new AmmError('INVALID_INTERVAL', 'intervalMs must not exceed the horizon');
  }
  return (totalAmountIn * intervalMs) / horizonMs;
}
