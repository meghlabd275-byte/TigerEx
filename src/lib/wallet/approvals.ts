/**
 * Withdrawal approval tiers (maker-checker).
 *
 * A large withdrawal should not be releasable by one operator. This module maps
 * a withdrawal's USD value to the number of *distinct* admin approvals it needs
 * before it can settle. Below the first configured tier the requirement is one
 * approval; at or above a tier it is that tier's count. The approvals are
 * recorded per (withdrawal, approver), so one operator cannot satisfy a 2-of-N
 * by approving twice.
 *
 * Tiers are operator policy stored in `withdrawal_approval_tiers`. An empty
 * table means the default of a single approval, which is the current behaviour;
 * configuring tiers is what turns maker-checker on. Nothing here fabricates an
 * approval — an approval is a real row with the operator's identity.
 *
 * The module is free of `next/server` so it can be unit tested.
 */

import { getDb } from '@/lib/db';

export interface ApprovalTier {
  /** The tier applies to withdrawals at or above this USD value. */
  minUsd: number;
  /** Distinct approvals required at or above `minUsd`. */
  requiredApprovals: number;
}

/** The configured tiers, ordered by `minUsd` ascending. */
export function withdrawalApprovalTiers(): ApprovalTier[] {
  const rows = getDb()
    .prepare('SELECT min_usd, required_approvals FROM withdrawal_approval_tiers ORDER BY min_usd ASC')
    .all() as Array<{ min_usd: number; required_approvals: number }>;
  return rows.map((row) => ({ minUsd: Number(row.min_usd), requiredApprovals: Number(row.required_approvals) }));
}

/**
 * Replace the tier table. Validated fail-closed: every tier needs a positive
 * `minUsd` and at least one approval, the `minUsd` values must be distinct, and
 * the required count must not decrease as the value rises (a larger withdrawal
 * can never need fewer approvals than a smaller one).
 */
export function setWithdrawalApprovalTiers(tiers: ApprovalTier[]): void {
  if (!Array.isArray(tiers)) throw new Error('tiers must be an array');
  const sorted = [...tiers].sort((a, b) => a.minUsd - b.minUsd);
  const seen = new Set<number>();
  let previousRequired = 0;
  for (const tier of sorted) {
    if (!Number.isFinite(tier.minUsd) || tier.minUsd <= 0) throw new Error('minUsd must be a positive number');
    if (!Number.isInteger(tier.requiredApprovals) || tier.requiredApprovals < 1) {
      throw new Error('requiredApprovals must be an integer of at least 1');
    }
    if (seen.has(tier.minUsd)) throw new Error(`duplicate tier at ${tier.minUsd}`);
    seen.add(tier.minUsd);
    if (tier.requiredApprovals < previousRequired) {
      throw new Error('requiredApprovals must not decrease as minUsd rises');
    }
    previousRequired = tier.requiredApprovals;
  }

  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM withdrawal_approval_tiers').run();
    const insert = db.prepare('INSERT INTO withdrawal_approval_tiers (min_usd, required_approvals) VALUES (?, ?)');
    for (const tier of sorted) insert.run(tier.minUsd, tier.requiredApprovals);
  })();
}

/**
 * The number of distinct approvals a withdrawal of `amountUsd` needs.
 *
 * A `null` amount (an unpriced withdrawal, which the policy normally forbids)
 * takes the strictest configured requirement, so an unpriced value can never
 * lower the bar.
 */
export function approvalsRequiredFor(amountUsd: number | null): number {
  const tiers = withdrawalApprovalTiers();
  if (tiers.length === 0) return 1;
  if (amountUsd === null) return Math.max(...tiers.map((t) => t.requiredApprovals));
  let required = 1;
  for (const tier of tiers) {
    if (amountUsd >= tier.minUsd) required = tier.requiredApprovals;
  }
  return required;
}

/** The distinct approvers recorded so far for a withdrawal. */
export function withdrawalApprovers(withdrawalId: string): string[] {
  const rows = getDb()
    .prepare('SELECT approver FROM withdrawal_approvals WHERE withdrawal_id = ? ORDER BY created_at ASC')
    .all(withdrawalId) as Array<{ approver: string }>;
  return rows.map((row) => row.approver);
}

export interface ApprovalState {
  required: number;
  received: number;
  approvers: string[];
  satisfied: boolean;
}

/**
 * Record one approval and report the resulting state.
 *
 * A repeat approval by the same operator does not advance the count, because the
 * row is unique per `(withdrawal, approver)`.
 */
export function recordWithdrawalApproval(withdrawalId: string, approver: string): ApprovalState {
  const actor = String(approver ?? '').trim();
  if (!actor) throw new Error('an approver is required');
  getDb()
    .prepare(
      `INSERT INTO withdrawal_approvals (withdrawal_id, approver, created_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(withdrawal_id, approver) DO NOTHING`,
    )
    .run(withdrawalId, actor);
  return withdrawalApprovalState(withdrawalId);
}

export function withdrawalApprovalState(withdrawalId: string): ApprovalState {
  const row = getDb()
    .prepare('SELECT amount_usd FROM withdrawals WHERE withdrawal_id = ?')
    .get(withdrawalId) as { amount_usd: number | null } | undefined;
  const required = approvalsRequiredFor(row?.amount_usd ?? null);
  const approvers = withdrawalApprovers(withdrawalId);
  return { required, received: approvers.length, approvers, satisfied: approvers.length >= required };
}
