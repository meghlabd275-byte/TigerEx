/**
 * Chain bootstrap from the environment.
 *
 * The chain registry is operator data, so nothing is seeded at build time. What
 * this module does is apply the deployment's own environment configuration once
 * at startup: when `TIGEREX_TSC_RPC_URL` is present, TigerSmartChain and its
 * tokens are listed (and their deposit networks enabled) so the wallet view and
 * the address issuer serve the chain immediately after a fresh migration.
 *
 * It never invents an endpoint. When the environment is unset the chain is
 * simply not listed, and every chain call fails closed until an administrator
 * lists one — the same state as a deployment that never configured it.
 *
 * Kept free of `next/server` so the decision can be exercised directly.
 */

import { tigerSmartChainConfig, registerTigerSmartChain } from '@/lib/chains/tigersmartchain';

export interface BootstrapResult {
  registered: string[];
  skipped: Array<{ chain: string; reason: string }>;
}

/**
 * Apply the environment's chain configuration.
 *
 * Returns what was registered and what was skipped with a reason, so the caller
 * can log the outcome. A malformed configuration is reported as a skip rather
 * than thrown, because one bad variable must not stop the process from starting;
 * the chain stays unlisted and therefore unserved.
 */
export function bootstrapChainsFromEnv(): BootstrapResult {
  const result: BootstrapResult = { registered: [], skipped: [] };

  const networks: Array<'mainnet' | 'testnet'> = ['mainnet', 'testnet'];
  for (const network of networks) {
    const config = tigerSmartChainConfig(network);
    if (!config) {
      result.skipped.push({
        chain: network === 'mainnet' ? 'tigersmartchain' : 'tigersmartchain-testnet',
        reason:
          network === 'mainnet'
            ? 'TIGEREX_TSC_RPC_URL is not set'
            : 'TIGEREX_TSC_TESTNET_RPC_URL is not set',
      });
      continue;
    }

    try {
      const { chain, tokens } = registerTigerSmartChain(network);
      result.registered.push(`${chain.chainKey} (${tokens.map((token) => token.symbol).join(', ')})`);
    } catch (error) {
      result.skipped.push({
        chain: config.chainKey,
        reason: error instanceof Error ? error.message : 'registration failed',
      });
    }
  }

  return result;
}
