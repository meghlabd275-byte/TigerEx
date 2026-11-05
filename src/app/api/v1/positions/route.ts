import { NextRequest } from 'next/server';
import { requireApiKey, v1Error, v1Ok } from '@/lib/api/v1-guard';
import { symbolParam } from '@/lib/api/route-guards';
import { listPositions } from '@/lib/trading/futures-engine';

/**
 * Open futures positions for the API-key's owner.
 *
 * Requires the `read` permission. Mark price, unrealized P&L and liquidation
 * price come from the venue's own risk engine, not a cached snapshot.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiKey(request, 'read', '');
  if ('error' in auth) return auth.error;

  const raw = request.nextUrl.searchParams.get('symbol');
  const symbol = raw === null ? null : symbolParam(raw);
  if (raw !== null && !symbol) return v1Error('VALIDATION_FAILED', 'symbol must look like BTC/RUSD');

  return v1Ok({ positions: listPositions(auth.identity.userId, symbol) });
}
