/**
 * P2P escrow state machine and pricing.
 *
 * A P2P trade holds the seller's asset in escrow until the buyer's fiat payment
 * is confirmed and the seller releases it, or a dispute is resolved. The state
 * machine is explicit so an order cannot jump from `pending` to `released`
 * without the fiat-confirmation step.
 */

export type P2pStatus =
  | 'pending'
  | 'paid'
  | 'released'
  | 'cancelled'
  | 'disputed'
  | 'resolved';

export type P2pEvent = 'pay' | 'release' | 'cancel' | 'dispute' | 'resolve';

/** Legal transitions. Any other event is refused. */
const TRANSITIONS: Record<P2pStatus, Partial<Record<P2pEvent, P2pStatus>>> = {
  pending: { pay: 'paid', cancel: 'cancelled', dispute: 'disputed' },
  paid: { release: 'released', dispute: 'disputed', cancel: 'cancelled' },
  released: {},
  cancelled: {},
  disputed: { resolve: 'resolved' },
  resolved: {},
};

export type TransitionResult = { status: P2pStatus } | { error: string };

export function transition(current: P2pStatus, event: P2pEvent): TransitionResult {
  const next = TRANSITIONS[current]?.[event];
  if (!next) return { error: `event ${event} is not allowed from status ${current}` };
  return { status: next };
}

/**
 * Fiat amount for a P2P trade, rounded to the fiat's precision.
 *
 * The fiat amount is the asset amount times the agreed price. A non-finite or
 * non-positive price or amount is refused rather than producing a zero order.
 */
export function fiatAmount(assetAmount: number, price: number, fiatPrecision = 2): number | { error: string } {
  if (!Number.isFinite(assetAmount) || assetAmount <= 0) return { error: 'assetAmount must be positive' };
  if (!Number.isFinite(price) || price <= 0) return { error: 'price must be positive' };
  if (!Number.isInteger(fiatPrecision) || fiatPrecision < 0 || fiatPrecision > 8) {
    return { error: 'fiatPrecision must be an integer in [0, 8]' };
  }
  const factor = Math.pow(10, fiatPrecision);
  return Math.round(assetAmount * price * factor) / factor;
}

/**
 * Whether a requested trade amount fits inside an offer's advertised limits.
 */
export function withinOfferLimits(
  assetAmount: number,
  minAmount: number,
  maxAmount: number,
  available: number,
): boolean {
  if (!Number.isFinite(assetAmount) || assetAmount <= 0) return false;
  if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount)) return false;
  if (!Number.isFinite(available)) return false;
  return assetAmount >= minAmount && assetAmount <= maxAmount && assetAmount <= available;
}

/**
 * The seller's escrow amount: the asset being sold, held until release.
 */
export function escrowAmount(assetAmount: number, feeRate = 0): number {
  if (!Number.isFinite(assetAmount) || assetAmount <= 0) return 0;
  const rate = Number.isFinite(feeRate) && feeRate > 0 ? Math.min(feeRate, 1) : 0;
  return assetAmount * (1 + rate);
}

/**
 * Split a disputed order's escrow according to the resolution.
 *
 * `buyerShare` is the fraction of the escrow returned to the buyer (1 means
 * the buyer wins entirely). The remainder goes to the seller. A share outside
 * [0, 1] is clamped rather than trusted.
 */
export function disputeSplit(
  escrow: number,
  buyerShare: number,
): { buyerAmount: number; sellerAmount: number } {
  const total = Number.isFinite(escrow) && escrow > 0 ? escrow : 0;
  const share = Number.isFinite(buyerShare) ? Math.min(Math.max(buyerShare, 0), 1) : 0;
  const buyerAmount = total * share;
  return { buyerAmount, sellerAmount: total - buyerAmount };
}
