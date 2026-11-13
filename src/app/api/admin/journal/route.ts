import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';
import { reconcileJournal } from '@/lib/db/accounting';
import { verifyChain } from '@/lib/db/journal';

/**
 * Admin double-entry journal view.
 *
 * Returns the state of the append-only journal: whether its hash chain is
 * intact, and whether the net user holding it records per asset matches the
 * materialised balances. Read-only — it never adjusts a balance.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json(
    {
      success: true,
      chain: verifyChain(),
      reconciliation: reconcileJournal(),
    },
    { headers: NO_STORE },
  );
}
