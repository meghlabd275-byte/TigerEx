/**
 * Revenue ledger writer shared by the trading engines.
 *
 * Every venue charges fees (spot and futures trading fees, margin interest,
 * options premium fees, ETF management fees) and each is real income the
 * exchange earned. The analytics and admin revenue dashboards aggregate
 * `revenue_ledger` by category, so a fee that is debited from a user but never
 * recorded here would silently understate revenue.
 *
 * Free of `next/server` so it can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';

/** Categories the engines write. Kept in one place so dashboards stay in sync. */
export const REVENUE_CATEGORIES = [
  'spot_fee',
  'futures_fee',
  'margin_interest',
  'options_fee',
  'etf_fee',
] as const;

export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number];

/**
 * Record an amount of exchange revenue.
 *
 * A non-finite or non-positive amount is a no-op rather than a zero-amount row.
 * `asset` is normalised to upper case so a caller cannot create two rows for the
 * same asset, and the amount is stored as-is (a fee is a real, already-charged
 * figure, never rounded here).
 */
export function recordRevenue(
  category: RevenueCategory,
  asset: string,
  amount: number,
  userId: string | null,
  reference: string,
): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const symbol = String(asset).trim().toUpperCase();
  if (!symbol) return;
  getDb()
    .prepare(
      `INSERT INTO revenue_ledger (entry_id, category, asset, amount, user_id, reference)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(generateId(), category, symbol, amount, userId, reference);
}
