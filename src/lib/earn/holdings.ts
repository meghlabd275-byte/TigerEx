/**
 * A user's earn and staking holdings.
 *
 * A holding is an `earn_subscriptions` row joined to the product it subscribed
 * to. The accrued reward is computed from the product's APR and the time the
 * principal has been locked, so the figure grows with real elapsed time rather
 * than being a stored constant.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';
import { parseUtcTimestamp } from '@/lib/trading/candles';
import { accrueSimple } from '@/lib/earn/products';

export interface EarnHolding {
  id: string;
  subscription_id: string;
  product_id: string;
  name: string;
  symbol: string;
  asset: string;
  amount: number;
  apy: number;
  rewards: number;
  accrued_reward: number;
  locked: boolean;
  lock_period_days: number | null;
  lock_period: string;
  type: string;
  status: string;
  started_at: string;
  matures_at: string | null;
  created_at: string;
}

function toHolding(row: Record<string, unknown>): EarnHolding {
  const amount = Number(row.amount) || 0;
  const apy = Number(row.apy) || 0;
  const durationDays = row.duration_days === null || row.duration_days === undefined ? null : Number(row.duration_days);
  const startedAt = String(row.started_at ?? row.created_at);
  const startedMs = parseUtcTimestamp(startedAt);
  const elapsedNs = Number.isFinite(startedMs) ? Math.max(0, (Date.now() - startedMs) * 1_000_000) : 0;

  // A locked product accrues only until it matures; a flexible one keeps going.
  const maturedMs = row.matures_at ? parseUtcTimestamp(String(row.matures_at)) : NaN;
  const effectiveNs =
    Number.isFinite(maturedMs) && maturedMs < Date.now() ? Math.max(0, (maturedMs - startedMs) * 1_000_000) : elapsedNs;

  const stored = Number(row.accrued_reward) || 0;
  const projected = accrueSimple(amount, apy, effectiveNs);
  const rewards = Math.max(stored, projected);

  return {
    id: String(row.subscription_id),
    subscription_id: String(row.subscription_id),
    product_id: String(row.product_id),
    name: String(row.name ?? row.asset ?? ''),
    symbol: String(row.asset),
    asset: String(row.asset),
    amount,
    apy,
    rewards,
    accrued_reward: rewards,
    locked: durationDays !== null && durationDays > 0,
    lock_period_days: durationDays,
    lock_period: durationDays !== null && durationDays > 0 ? `${durationDays} days` : 'Flexible',
    type: durationDays !== null && durationDays > 0 ? 'locked' : 'flexible',
    status: String(row.status),
    started_at: startedAt,
    matures_at: row.matures_at === null || row.matures_at === undefined ? null : String(row.matures_at),
    created_at: startedAt,
  };
}

/**
 * The caller's earn subscriptions, newest first.
 *
 * Only rows that still hold a principal (active) or that have matured are
 * returned; a redeemed subscription is history, not a holding.
 */
export function userHoldings(userId: string, options: { status?: string } = {}): EarnHolding[] {
  const clauses = ['s.user_id = ?'];
  const params: Array<string | number> = [userId];
  if (options.status) {
    clauses.push('s.status = ?');
    params.push(options.status);
  } else {
    clauses.push("s.status IN ('active', 'matured')");
  }

  const rows = getDb()
    .prepare(
      `SELECT s.subscription_id, s.product_id, s.amount, s.accrued_reward, s.status,
              s.started_at, s.matures_at, s.redeemed_at,
              p.name, p.asset, p.apy, p.duration_days, p.product_type
         FROM earn_subscriptions s
         JOIN earn_products p ON p.product_id = s.product_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY s.started_at DESC
        LIMIT 500`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map(toHolding);
}
