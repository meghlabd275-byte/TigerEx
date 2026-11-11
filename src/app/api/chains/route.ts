import { NextRequest, NextResponse } from 'next/server';
import { activeChains, activeTokens } from '@/lib/chains/registry';
import { NO_STORE, enforceRateLimit } from '@/lib/api/route-guards';

/**
 * The chains the exchange serves, with the tokens listed on each.
 *
 * This is public configuration the wallet and deposit views need before a user
 * signs in. Only active chains and tokens are returned; a paused chain is not
 * offered. The response is never cached, so a listing change is visible at once.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const guard = enforceRateLimit(request, 'chains.list', 120, 60_000);
  if (guard) return guard;

  const chains = activeChains().map((chain) => ({
    chainKey: chain.chainKey,
    name: chain.name,
    chainType: chain.chainType,
    chainId: chain.chainId,
    nativeSymbol: chain.nativeSymbol,
    nativeDecimals: chain.nativeDecimals,
    explorerUrl: chain.explorerUrl,
    // The node URL is deliberately not exposed: it is an internal endpoint and
    // may carry a private hostname.
    tokens: activeTokens(chain.chainKey).map((token) => ({
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      contractAddress: token.contractAddress,
      isNative: token.contractAddress === null,
    })),
  }));

  return NextResponse.json({ success: true, chains }, { headers: NO_STORE });
}
