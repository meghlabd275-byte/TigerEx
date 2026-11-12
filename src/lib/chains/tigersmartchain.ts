/**
 * TigerSmartChain integration descriptor.
 *
 * TigerSmartChain (TSC) is TigerEx's own EVM chain. Its chain id and native
 * coin come from the chain itself — the `tigersmartchaind` daemon defaults to
 * chain id 9001 (testnet 9000), per `cmd/tigersmartchaind/src/main.rs` and the
 * chain's Go/Python/Rust SDKs — with native coin TGR (Tiger Coin), 18 decimals.
 * The node URL the exchange dials, the explorer URL and the RUSD stablecoin
 * contract address are deployment configuration, read from the environment.
 *
 * Nothing here invents an endpoint or a contract address: when
 * `TIGEREX_TSC_RPC_URL` is unset the chain is simply not served, and when the
 * RUSD address is unset only the native coin is listed. A placeholder address
 * would make the wallet read a balance from a contract that does not exist.
 */

import { ChainRecord, TokenRecord, upsertChain, upsertToken, getChain, listTokens } from '@/lib/chains/registry';
import { isHexAddress } from '@/lib/chains/evm-rpc';
import { upsertNetwork } from '@/lib/wallet/networks';

/**
 * TigerSmartChain mainnet chain id. The daemon's `--chain-id` default is 9001
 * and every SDK (Go `NewClient`, Python `ChainID.MAINNET`) agrees; the chain id
 * is fixed by the chain, not by TigerEx.
 */
export const TSC_MAINNET_CHAIN_ID = 9001;
/** TigerSmartChain testnet chain id, per the chain's Python SDK (`ChainID.TESTNET`). */
export const TSC_TESTNET_CHAIN_ID = 9000;

/** The native coin's symbol and decimals. */
export const TSC_NATIVE_SYMBOL = 'TGR';
export const TSC_NATIVE_DECIMALS = 18;

/** The stablecoin's symbol and decimals. */
export const RUSD_SYMBOL = 'RUSD';
/**
 * RUSD decimals. Royal Tiger USD is a 1:1 USD stablecoin, and the chain's own
 * `TokenFactoryWithPresets.Stablecoin` preset creates stablecoins with 6
 * decimals (the USDT/USDC convention), so 6 is the default. The operator may
 * override with `TIGEREX_TSC_RUSD_DECIMALS` when the deployed contract differs.
 */
export const RUSD_DECIMALS = 6;

export interface TigerSmartChainConfig {
  chainKey: string;
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  /** The RUSD ERC-20 contract, or null when not configured. */
  rusdAddress: string | null;
}

function env(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The chain configuration from the environment.
 *
 * `chainKey` selects mainnet or testnet; the RPC URL and RUSD address come from
 * environment variables. Returns null when the selected network's node URL is
 * not configured, so a caller cannot register a chain with no endpoint.
 */
export function tigerSmartChainConfig(network: 'mainnet' | 'testnet' = 'mainnet'): TigerSmartChainConfig | null {
  const mainnet = network === 'mainnet';
  const rpcUrl = env(mainnet ? 'TIGEREX_TSC_RPC_URL' : 'TIGEREX_TSC_TESTNET_RPC_URL');
  if (!rpcUrl) return null;

  const rawRusd = env('TIGEREX_TSC_RUSD_ADDRESS');
  const rusdAddress = rawRusd && isHexAddress(rawRusd) ? rawRusd : null;

  // The explorer is optional deployment configuration; nothing is invented.
  const explorerUrl = env('TIGEREX_TSC_EXPLORER_URL') ?? '';

  // The daemon takes `--chain-id`, so a deployment that runs its own network can
  // name the id it actually serves. When the override is unset the chain's own
  // default (9001 / 9000) is used, and the on-chain reader still refuses to trust
  // a node whose `eth_chainId` differs from whatever is recorded here.
  const overrideRaw = env(mainnet ? 'TIGEREX_TSC_CHAIN_ID' : 'TIGEREX_TSC_TESTNET_CHAIN_ID');
  const override = overrideRaw === null ? null : Number(overrideRaw);
  const chainId =
    override !== null && Number.isInteger(override) && override >= 0
      ? override
      : mainnet
        ? TSC_MAINNET_CHAIN_ID
        : TSC_TESTNET_CHAIN_ID;

  return {
    chainKey: mainnet ? 'tigersmartchain' : 'tigersmartchain-testnet',
    chainId,
    name: mainnet ? 'TigerSmartChain' : 'TigerSmartChain Testnet',
    rpcUrl,
    explorerUrl,
    rusdAddress,
  };
}

export interface TigerSmartChainRegistration {
  chain: ChainRecord;
  tokens: TokenRecord[];
}

/** The network name a deposit listing uses for a TigerSmartChain network. */
export function tigerSmartChainNetworkName(network: 'mainnet' | 'testnet' = 'mainnet'): string {
  return network === 'mainnet' ? 'TIGERSMARTCHAIN' : 'TIGERSMARTCHAIN-TESTNET';
}

/**
 * Register TigerSmartChain, its tokens and its deposit networks.
 *
 * Idempotent: re-running updates the stored rows. Fails closed when the node URL
 * is not configured, and lists RUSD only when its contract address is
 * configured — the native coin needs no address. Intended to be invoked by an
 * operator (or the startup bootstrap) rather than on every request.
 *
 * The deposit listing is what lets a user be issued a TSC address: without it
 * `networkEnabled` refuses and the address issuer stops before the custody seed
 * is consulted. Only TGR and (when configured) RUSD are listed, so the exchange
 * never issues an address for an asset it cannot settle on this chain.
 */
export function registerTigerSmartChain(network: 'mainnet' | 'testnet' = 'mainnet'): TigerSmartChainRegistration {
  const config = tigerSmartChainConfig(network);
  if (!config) {
    throw new Error(
      network === 'mainnet'
        ? 'TIGEREX_TSC_RPC_URL must be set to register TigerSmartChain'
        : 'TIGEREX_TSC_TESTNET_RPC_URL must be set to register TigerSmartChain testnet',
    );
  }

  const chain = upsertChain({
    chainKey: config.chainKey,
    name: config.name,
    chainType: 'evm',
    chainId: config.chainId,
    nativeSymbol: TSC_NATIVE_SYMBOL,
    nativeDecimals: TSC_NATIVE_DECIMALS,
    rpcUrl: config.rpcUrl,
    explorerUrl: config.explorerUrl,
    status: 'active',
  });

  const tokens: TokenRecord[] = [
    upsertToken({
      chainKey: config.chainKey,
      symbol: TSC_NATIVE_SYMBOL,
      name: 'Tiger Coin',
      decimals: TSC_NATIVE_DECIMALS,
      status: 'active',
    }),
  ];

  if (config.rusdAddress) {
    // The decimals are deployment configuration (the operator knows the
    // contract); when unset the stablecoin default (6) is used. A wrong value
    // would only misformat a display amount, never move funds, but the override
    // exists so a contract that is not the 6-decimal stablecoin preset is still
    // reported correctly.
    const rusdDecimals = Number(process.env.TIGEREX_TSC_RUSD_DECIMALS ?? String(RUSD_DECIMALS));
    tokens.push(
      upsertToken({
        chainKey: config.chainKey,
        symbol: RUSD_SYMBOL,
        name: 'Royal Tiger USD',
        contractAddress: config.rusdAddress,
        decimals:
          Number.isInteger(rusdDecimals) && rusdDecimals >= 0 && rusdDecimals <= 255
            ? rusdDecimals
            : RUSD_DECIMALS,
        status: 'active',
      }),
    );
  }

  // The deposit listing follows the token list: a user may only be issued an
  // address for an asset the exchange actually lists on this chain.
  const depositNetwork = tigerSmartChainNetworkName(network);
  const confirmations = Number(process.env.TIGEREX_TSC_CONFIRMATIONS ?? '12');
  for (const token of tokens) {
    upsertNetwork({
      asset: token.symbol,
      network: depositNetwork,
      displayName: `${config.name} (${token.symbol})`,
      minDeposit: 0.000000000000000001,
      confirmations: Number.isInteger(confirmations) && confirmations > 0 ? confirmations : 12,
      memoRequired: false,
      status: 'active',
    });
  }

  return { chain, tokens };
}

/** Whether TigerSmartChain is currently listed, for the wallet view. */
export function tigerSmartChainRegistered(network: 'mainnet' | 'testnet' = 'mainnet'): boolean {
  const key = network === 'mainnet' ? 'tigersmartchain' : 'tigersmartchain-testnet';
  return getChain(key) !== null;
}

/** The tokens listed on TigerSmartChain, when it is registered. */
export function tigerSmartChainTokens(network: 'mainnet' | 'testnet' = 'mainnet'): TokenRecord[] {
  const key = network === 'mainnet' ? 'tigersmartchain' : 'tigersmartchain-testnet';
  return listTokens(key);
}
