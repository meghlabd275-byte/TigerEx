import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { NO_STORE, enforceRateLimit } from '@/lib/api/route-guards';
import { readUserOnChainBalances } from '@/lib/chains/onchain';
import { EvmRpcError } from '@/lib/chains/evm-rpc';

/**
 * The caller's on-chain balances.
 *
 * Each balance is read live from the node the registry records for the chain,
 * at the address the user holds there. Nothing is cached and nothing is
 * estimated: a chain whose node cannot be reached is listed under `errors`
 * rather than reported as a zero balance.
 *
 * The node call is network-bound, so the route is rate limited and marked
 * `force-dynamic`.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRateLimit(request, 'wallet.onchain', 60, 60_000);
  if (guard) return guard;

  try {
    const { results, errors } = await readUserOnChainBalances(auth.user.userId);
    return NextResponse.json({ success: true, chains: results, errors }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EvmRpcError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers: NO_STORE },
      );
    }
    throw error;
  }
}
