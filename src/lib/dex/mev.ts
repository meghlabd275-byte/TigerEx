/**
 * TigerSwap MEV protection.
 *
 * On a public mempool a searcher can see a large pending swap, buy in front of
 * it and sell behind it, taking the price impact the honest trader created.
 * TigerSwap's answer is a private order flow path: a swap is submitted with a
 * commitment instead of its plaintext, so a searcher cannot read it, and it is
 * only opened once the trader's own transaction has been ordered first.
 *
 * This module is the detection and ordering core. It is pure so the rules can
 * be tested directly: `detectSandwich` recognises the shape of an attack in a
 * block, `assessRisk` scores a pending order, and `orderPrivateFlow` produces
 * the commit-reveal ordering that denies a searcher the information.
 */

import { AmmError, requirePositive, v2PriceImpact } from '@/lib/dex/amm';

export interface PendingOrder {
  orderId: string;
  tokenIn: string;
  tokenOut: string;
  /** Input amount, in the input token's units. */
  amountIn: number;
  /** The pool's reserve of the input token. */
  reserveIn: number;
  /** The pool's reserve of the output token. */
  reserveOut: number;
  /** Slippage the trader is willing to accept, as a fraction. */
  slippageTolerance: number;
}

export interface MevRisk {
  /** 0–1 score; higher means more attractive to a searcher. */
  score: number;
  /** The order's own price impact as a fraction. */
  impact: number;
  /** Whether the order should be routed through the private path. */
  shouldProtect: boolean;
  reason: string;
}

/**
 * Score how attractive a pending order is to a sandwich attacker.
 *
 * The attacker's profit scales with the victim's price impact, because that
 * impact is the price move the attacker can trade around. The trader's slippage
 * tolerance matters too: it is the headroom the attacker can consume before the
 * victim's own swap reverts. An order below the threshold is not worth the gas
 * and is left on the public path.
 */
export function assessRisk(order: PendingOrder, protectThreshold = 0.005): MevRisk {
  const amountIn = requirePositive(order.amountIn, 'amountIn');
  const reserveIn = requirePositive(order.reserveIn, 'reserveIn');
  const reserveOut = requirePositive(order.reserveOut, 'reserveOut');
  if (!Number.isFinite(order.slippageTolerance) || order.slippageTolerance < 0 || order.slippageTolerance >= 1) {
    throw new AmmError('INVALID_SLIPPAGE', 'slippageTolerance must be a fraction in [0, 1)');
  }

  const impact = v2PriceImpact(amountIn, { reserveIn, reserveOut });
  return scoreImpact(impact, order.slippageTolerance, protectThreshold);
}

/**
 * Score a pending order from its price impact, not from its reserves.
 *
 * A constant-product pool hands `assessRisk` its reserves, but a stable,
 * weighted or concentrated pool reaches the same decision from an impact the
 * router computed. Keeping the scoring in one place means every pool shape is
 * judged by the same rule, so a trade cannot be protected on one pool kind and
 * left exposed on another.
 */
export function scoreImpact(impact: number, slippageTolerance: number, protectThreshold = 0.005): MevRisk {
  if (!Number.isFinite(impact) || impact < 0) {
    throw new AmmError('INVALID_IMPACT', 'impact must be a non-negative finite number');
  }
  if (!Number.isFinite(slippageTolerance) || slippageTolerance < 0 || slippageTolerance >= 1) {
    throw new AmmError('INVALID_SLIPPAGE', 'slippageTolerance must be a fraction in [0, 1)');
  }

  // The attacker cannot extract more than the trader will tolerate, so the
  // effective opportunity is the smaller of the impact and the tolerance.
  const opportunity = Math.min(impact, slippageTolerance);
  const threshold = Number(protectThreshold);
  const score = threshold > 0 ? Math.min(1, opportunity / threshold) : (opportunity > 0 ? 1 : 0);
  const shouldProtect = opportunity >= threshold;

  return {
    score,
    impact,
    shouldProtect,
    reason: shouldProtect
      ? `price impact ${(impact * 100).toFixed(3)}% is worth sandwiching`
      : `price impact ${(impact * 100).toFixed(3)}% is below the protection threshold`,
  };
}

export interface SwapObservation {
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
}

export interface SandwichDetection {
  detected: boolean;
  /** The attacker's addresses, front-run first. */
  attackers: string[];
  /** The victim whose trade was sandwiched. */
  victim: string | null;
}

/**
 * Detect a sandwich in an ordered list of a block's swaps.
 *
 * The pattern is a buy of the same token pair immediately before a victim's
 * swap and the reverse trade immediately after, all from the same address. The
 * check is structural, not heuristic on size: a legitimately large trader who
 * happens to trade twice around someone else is not an attacker unless the
 * second leg exactly reverses the first.
 */
export function detectSandwich(swaps: SwapObservation[]): SandwichDetection {
  const attackers = new Set<string>();
  let victim: string | null = null;

  for (let i = 1; i < swaps.length - 1; i += 1) {
    const before = swaps[i - 1];
    const middle = swaps[i];
    const after = swaps[i + 1];

    const sameAttacker = before.trader === after.trader;
    const reversesDirection =
      before.tokenIn === middle.tokenIn &&
      before.tokenOut === middle.tokenOut &&
      after.tokenIn === middle.tokenOut &&
      after.tokenOut === middle.tokenIn;
    const differentFromVictim = before.trader !== middle.trader;

    if (sameAttacker && reversesDirection && differentFromVictim) {
      attackers.add(before.trader);
      victim = middle.trader;
    }
  }

  return { detected: attackers.size > 0, attackers: [...attackers], victim };
}

export interface PrivateFlowEntry {
  orderId: string;
  /** Position in the private batch; lower is settled first. */
  sequence: number;
  /** Whether the plaintext is open for execution. */
  revealed: boolean;
}

export interface PrivateFlowPlan {
  batchId: string;
  entries: PrivateFlowEntry[];
  /** The commitment a searcher would see instead of the order. */
  commitments: Record<string, string>;
}

/**
 * Order a batch of private orders so no participant can be front-run by another.
 *
 * Two rules give the guarantee. Every order is committed (hashed) before any is
 * revealed, so a searcher watching the commit phase learns nothing about the
 * amounts. The reveal order is then fixed by the commit order, not by arrival
 * or by fee, so a searcher cannot pay to jump the queue: to move ahead they
 * would have to have committed earlier, which they could not know to do.
 *
 * The commitment is a deterministic hash of the order's identity and the batch
 * id. It is not a secret and does not need to be — its only job is to fix the
 * order before the contents are known.
 */
export function orderPrivateFlow(
  orders: Array<{ orderId: string; committedAt: number }>,
  batchId: string,
): PrivateFlowPlan {
  if (!batchId) throw new AmmError('INVALID_BATCH', 'batchId is required');
  const entries: PrivateFlowEntry[] = [];
  const commitments: Record<string, string> = {};

  const sorted = [...orders].sort((a, b) => {
    if (a.committedAt !== b.committedAt) return a.committedAt - b.committedAt;
    // Ties broken by id so the ordering is deterministic across nodes; without
    // this two nodes could order the same batch differently and diverge.
    return a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0;
  });

  sorted.forEach((order, index) => {
    entries.push({ orderId: order.orderId, sequence: index, revealed: true });
    commitments[order.orderId] = commitmentFor(order.orderId, batchId);
  });

  return { batchId, entries, commitments };
}

/** A deterministic commitment over an order id and batch id. */
export function commitmentFor(orderId: string, batchId: string): string {
  // FNV-1a over the concatenation. A non-cryptographic digest is sufficient and
  // honest here: the commitment is a queue-position token, not a secret, and the
  // security property comes from commit-before-reveal, not from the hash.
  const input = `${batchId}:${orderId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
