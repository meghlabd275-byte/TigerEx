import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE, enforceRequestGuards } from '@/lib/api/route-guards';
import {
  registerTigerSmartChain,
  tigerSmartChainConfig,
  tigerSmartChainRegistered,
  tigerSmartChainTokens,
  TSC_MAINNET_CHAIN_ID,
  TSC_TESTNET_CHAIN_ID,
} from '@/lib/chains/tigersmartchain';

/**
 * TigerSmartChain registration.
 *
 * TigerSmartChain is the exchange's own EVM chain. Its node URL and the RUSD
 * contract address are deployment configuration read from the environment, so
 * this route only applies that configuration to the registry — it cannot invent
 * an endpoint. `GET` reports the effective configuration and what is currently
 * listed; `POST` registers the chain, its tokens and their deposit networks.
 *
 * When `TIGEREX_TSC_RPC_URL` (or the testnet equivalent) is unset the POST fails
 * closed: the chain is left unlisted and the wallet serves nothing for it, which
 * is the correct state for a deployment that has not configured the chain.
 */
export const dynamic = 'force-dynamic';

function describe(network: 'mainnet' | 'testnet') {
  const config = tigerSmartChainConfig(network);
  return {
    network,
    configured: config !== null,
    registered: tigerSmartChainRegistered(network),
    chainKey: config?.chainKey ?? (network === 'mainnet' ? 'tigersmartchain' : 'tigersmartchain-testnet'),
    chainId: config?.chainId ?? (network === 'mainnet' ? TSC_MAINNET_CHAIN_ID : TSC_TESTNET_CHAIN_ID),
    name: config?.name ?? null,
    // The node URL is internal and may name a private host, so it is not echoed.
    hasRusdAddress: config?.rusdAddress !== null && config?.rusdAddress !== undefined,
    tokens: tigerSmartChainRegistered(network)
      ? tigerSmartChainTokens(network).map((token) => ({
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          contractAddress: token.contractAddress,
          status: token.status,
        }))
      : [],
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json(
    { success: true, mainnet: describe('mainnet'), testnet: describe('testnet') },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.chains.tigerSmartChain');
  if (guard) return guard;

  const body = (await readJson(request)) ?? {};
  const network = String(body.network ?? 'mainnet').trim().toLowerCase();
  if (network !== 'mainnet' && network !== 'testnet') {
    return fail('VALIDATION_FAILED', 'network must be mainnet or testnet');
  }

  try {
    const { chain, tokens } = registerTigerSmartChain(network);
    recordAdminAction(request, auth.admin, 'admin.chains.tigerSmartChain.register', {
      type: 'blockchain_chain',
      id: chain.chainKey,
      detail: { chainId: chain.chainId, tokens: tokens.map((token) => token.symbol) },
    });
    return NextResponse.json(
      {
        success: true,
        chain: {
          chainKey: chain.chainKey,
          name: chain.name,
          chainId: chain.chainId,
          nativeSymbol: chain.nativeSymbol,
          status: chain.status,
        },
        tokens: tokens.map((token) => ({
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          contractAddress: token.contractAddress,
          status: token.status,
        })),
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    // A missing node URL is a configuration refusal, not a server fault.
    return fail('CHAIN_NOT_CONFIGURED', error instanceof Error ? error.message : 'Registration failed', 409);
  }
}
