/**
 * TigerSwap perpetual conditional-order triggers.
 *
 * A stop-loss, take-profit or trailing stop parks off the book until the mark
 * price crosses its condition, then reduces the position it protects. This
 * module is the pure trigger rule: given the order and the current mark it
 * decides whether to fire and what the trailing anchor becomes. It is free of
 * the database and the ledger so the rule can be exercised directly, and it
 * fails closed on a missing or non-positive price rather than firing on a
 * guess.
 */

import { AmmError } from '@/lib/dex/amm';

export type ConditionalType = 'stop_loss' | 'take_profit' | 'trailing_stop';

export const CONDITIONAL_TYPES: readonly ConditionalType[] = ['stop_loss', 'take_profit', 'trailing_stop'];

export interface ConditionalTriggerInput {
  type: ConditionalType;
  /** The side of the position the order protects. */
  positionSide: 'long' | 'short';
  /** Required for `stop_loss` and `take_profit`. */
  stopPrice?: number | null;
  /** Required for `trailing_stop`: the retracement from the best price, as a fraction. */
  callbackRate?: number | null;
  /** The current mark price. */
  mark: number;
  /**
   * The trailing anchor carried between cycles: the best price seen since the
   * order was placed. Starts at the entry price. Ignored by the fixed-price
   * types.
   */
  anchor?: number | null;
}

export interface ConditionalTriggerResult {
  /** Whether the order should fire at this mark. */
  trigger: boolean;
  /** The trailing anchor to persist for the next cycle. */
  anchor: number;
}

function requirePositive(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new AmmError('INVALID_PRICE', `${name} must be positive`);
  return n;
}

/**
 * Evaluate one conditional order against the current mark.
 *
 * A long's stop-loss fires when the mark falls to or below the stop, its
 * take-profit when the mark rises to or above it; a short is the mirror. A
 * trailing stop tracks the best price the position has seen — the peak for a
 * long, the trough for a short — and fires once the mark retraces `callbackRate`
 * from it. The anchor only ever moves in the position's favour, so a retracement
 * cannot loosen the stop.
 */
export function evaluateConditional(input: ConditionalTriggerInput): ConditionalTriggerResult {
  const mark = requirePositive(input.mark, 'mark');
  const positionSide = input.positionSide === 'long' ? 'long' : 'short';

  if (input.type === 'trailing_stop') {
    const rate = Number(input.callbackRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
      throw new AmmError('INVALID_RATE', 'callbackRate must be a fraction between 0 and 1');
    }
    const start = input.anchor === null || input.anchor === undefined ? mark : requirePositive(input.anchor, 'anchor');
    if (positionSide === 'long') {
      const peak = Math.max(start, mark);
      return { trigger: mark <= peak * (1 - rate), anchor: peak };
    }
    const trough = Math.min(start, mark);
    return { trigger: mark >= trough * (1 + rate), anchor: trough };
  }

  const stop = requirePositive(input.stopPrice, 'stopPrice');
  if (input.type === 'stop_loss') {
    return { trigger: positionSide === 'long' ? mark <= stop : mark >= stop, anchor: mark };
  }
  return { trigger: positionSide === 'long' ? mark >= stop : mark <= stop, anchor: mark };
}

/**
 * The quantity a triggered order should reduce, capped at the live position.
 *
 * A reduce-only order can never flip the position, so the reduction is the
 * smaller of what the order asked for and what is still open. A position that
 * has already gone returns zero, which the caller treats as "nothing to do"
 * rather than opening an opposite position.
 */
export function reductionQuantity(orderQuantity: number, positionSize: number): number {
  const requested = Number(orderQuantity);
  const open = Number(positionSize);
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  if (!Number.isFinite(open) || open <= 0) return 0;
  return Math.min(requested, open);
}

/**
 * Validate a conditional order's parameters before it is stored.
 *
 * The fixed-price types need a positive stop; a trailing stop needs a callback
 * fraction strictly inside `(0, 1)`. The stop's side relative to the mark is
 * enforced by the service, which is the layer that can observe the position.
 */
export function validateConditionalParams(
  type: ConditionalType,
  params: { stopPrice?: unknown; callbackRate?: unknown },
): { stopPrice: number | null; callbackRate: number | null } {
  if (type === 'trailing_stop') {
    const rate = Number(params.callbackRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
      throw new AmmError('INVALID_RATE', 'callbackRate must be a fraction between 0 and 1');
    }
    return { stopPrice: null, callbackRate: rate };
  }
  return { stopPrice: requirePositive(params.stopPrice, 'stopPrice'), callbackRate: null };
}
