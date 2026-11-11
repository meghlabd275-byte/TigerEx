/**
 * On-chain balance reads for the wallet view.
 *
 * A balance is read from the chain node the registry records for the chain the
 * user's address sits on: the native coin through `eth_getBalance`, an ERC-20
 * through `balanceOf`. The node's reported chain id is checked against the
 * registry before any balance is trusted, so a node that has been pointed at a
 * different network fails closed rather than reporting another chain's numbers.
 *
 * There is no cache and no fallback: a node that cannot be reached raises
 * `EvmRpcError`, and the caller reports the chain as unavailable rather than
 * showing a zero the account may not have.
 */

import { getDb } from '@/lib/db';
import { getChain, activeTokens, ChainRecord, TokenRecord } from '@/lib/chains/registry';
import {
  EvmRpcError,
  formatUnits,
  rpcChainId,
  rpcErc20Balance,
  rpcNativeBalance,
  JsonRpcOptions,
} from '@/lib/chains/evm-rpc';

export interface OnChainBalance {
  chainKey: string;
  symbol: string;
  /** Base-unit amount as an integer string. */
  raw: string;
  /** Human amount, formatted with the token's decimals. */
  amount: string;
  decimals: number;
  contractAddress: string | null;
  isNative: boolean;
}

export interface OnChainBalanceResult {
  chainKey: string;
  chainName: string;
  address: string;
  chainId: number;
  balances: OnChainBalance[];
}

/** The addresses the user holds on a chain, from their wallet rows. */
export function walletAddressesFor(userId: string, chainKey: string): string[] {
  const key = String(chainKey ?? '').trim().toUpperCase();
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT address FROM wallets
        WHERE user_id = ? AND UPPER(network) = ? AND address IS NOT NULL AND address <> ''
        ORDER BY address`,
    )
    .all(userId, key) as Array<{ address: string }>;
  return rows.map((row) => row.address);
}

/**
 * Read every listed token balance for one address on one chain.
 *
 * The chain id the node reports must equal the registry's, otherwise the read
 * is refused: a mismatch means the URL now points at a different network and
 * every number would be wrong.
 */
export async function readChainBalances(
  chain: ChainRecord,
  address: string,
  options: JsonRpcOptions = {},
): Promise<OnChainBalance[]> {
  if (chain.chainType !== 'evm') {
    throw new EvmRpcError(
      'CHAIN_NOT_EVM',
      `On-chain reads are not available for ${chain.name} (${chain.chainType})`,
      409,
    );
  }

  const reported = await rpcChainId(chain.rpcUrl, options);
  if (reported !== BigInt(chain.chainId)) {
    throw new EvmRpcError(
      'CHAIN_ID_MISMATCH',
      `The node for ${chain.name} reports chain id ${reported}, expected ${chain.chainId}`,
      502,
    );
  }

  const tokens = activeTokens(chain.chainKey);
  const balances: OnChainBalance[] = [];

  for (const token of tokens) {
    const isNative = token.contractAddress === null;
    const raw = isNative
      ? await rpcNativeBalance(chain.rpcUrl, address, options)
      : await rpcErc20Balance(chain.rpcUrl, token.contractAddress as string, address, options);
    balances.push({
      chainKey: chain.chainKey,
      symbol: token.symbol,
      raw: raw.toString(),
      amount: formatUnits(raw, token.decimals),
      decimals: token.decimals,
      contractAddress: token.contractAddress,
      isNative,
    });
  }

  return balances;
}

/**
 * Read the caller's balances across every chain they hold an address on.
 *
 * A chain whose node is unreachable is reported in `errors` and skipped, so one
 * failing node does not hide the balances read from the others.
 */
export async function readUserOnChainBalances(
  userId: string,
  options: JsonRpcOptions = {},
): Promise<{ results: OnChainBalanceResult[]; errors: Array<{ chainKey: string; code: string; message: string }> }> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT UPPER(network) AS network FROM wallets
        WHERE user_id = ? AND address IS NOT NULL AND address <> ''
        ORDER BY network`,
    )
    .all(userId) as Array<{ network: string }>;

  const results: OnChainBalanceResult[] = [];
  const errors: Array<{ chainKey: string; code: string; message: string }> = [];

  for (const row of rows) {
    const chain = getChain(row.network);
    if (!chain || chain.status !== 'active') continue;
    const address = walletAddressesFor(userId, chain.chainKey)[0];
    if (!address) continue;

    try {
      const balances = await readChainBalances(chain, address, options);
      results.push({
        chainKey: chain.chainKey,
        chainName: chain.name,
        address,
        chainId: chain.chainId,
        balances,
      });
    } catch (error) {
      if (error instanceof EvmRpcError) {
        errors.push({ chainKey: chain.chainKey, code: error.code, message: error.message });
        continue;
      }
      throw error;
    }
  }

  return { results, errors };
}

/** The token listing a symbol resolves to on a chain, or null. */
export function tokenOnChain(chainKey: string, symbol: string): TokenRecord | null {
  const upper = String(symbol ?? '').trim().toUpperCase();
  return activeTokens(chainKey).find((token) => token.symbol === upper) ?? null;
}
