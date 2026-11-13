import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { NO_STORE } from '@/lib/api/route-guards';
import { buildReservesReport } from '@/lib/compliance/reserves';
import { getDb } from '@/lib/db';

/**
 * Proof of reserves.
 *
 * Returns the current Merkle root over every user liability, the aggregate
 * liabilities per asset, and — for the authenticated user — the inclusion proof
 * for their own balances. The published root commits to the whole ledger, so a
 * user can recompute the root from their proof plus the public commitments
 * without the response ever revealing another account's holdings.
 *
 * This route is DB-backed and self-contained: it computes from the venue's own
 * `balances` table and never calls an external backend.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const report = buildReservesReport({ includeProofs: true });
  const userId = auth.user.userId;

  const db = getDb();
  const mine = db
    .prepare(
      `SELECT b.currency AS asset, SUM(b.available + b.locked) AS amount
         FROM balances b
         JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ?
        GROUP BY b.currency
       HAVING SUM(b.available + b.locked) > 0
        ORDER BY b.currency`,
    )
    .all(userId) as Array<{ asset: string; amount: number }>;

  // The proof leaves are keyed by (user, asset) in the order the report built
  // them, so the user's balances are matched by asset.
  const proofsByAsset = new Map<string, string[]>();
  if (report.proofs) {
    const liabilities = db
      .prepare(
        `SELECT w.user_id AS user_id, b.currency AS asset, SUM(b.available + b.locked) AS amount
           FROM balances b
           JOIN wallets w ON w.wallet_id = b.wallet_id
          GROUP BY w.user_id, b.currency
         HAVING SUM(b.available + b.locked) > 0
          ORDER BY w.user_id, b.currency`,
      )
      .all() as Array<{ user_id: string; asset: string; amount: number }>;
    liabilities.forEach((row, index) => {
      if (row.user_id === userId) proofsByAsset.set(row.asset, report.proofs![index].siblings);
    });
  }

  return NextResponse.json(
    {
      success: true,
      merkleRoot: report.merkleRoot,
      generatedAt: report.generatedAt,
      leafCount: report.leafCount,
      liabilities: report.assets,
      myBalances: mine.map((row) => ({
        asset: row.asset,
        amount: Number(row.amount),
        proof: proofsByAsset.get(row.asset) ?? [],
      })),
    },
    { headers: NO_STORE },
  );
}
