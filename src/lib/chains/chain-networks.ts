/**
 * EVM network aliases.
 *
 * Every name a chain is known by in configuration, deposits and the wallet
 * registry maps to EVM-style address handling: a 20-byte `0x` address with an
 * EIP-55 checksum. This is the single list the address validator and the
 * derivation module consult, so a chain added here is treated consistently
 * everywhere instead of in one place and not another.
 *
 * TigerSmartChain (TSC) is an EVM chain, so its names belong here; a TigerEx
 * deposit address on it is an ordinary EVM address.
 */

export const EVM_CHAIN_NETWORKS = new Set([
  'ERC20', 'ETH', 'ETHEREUM', 'BEP20', 'BSC', 'BNB', 'POLYGON', 'MATIC', 'AVALANCHE',
  'AVAXC', 'ARBITRUM', 'OPTIMISM', 'BASE', 'LINEA', 'SCROLL', 'ZKSYNC', 'MANTLE',
  'BLAST', 'CELO', 'FTM', 'FANTOM', 'GNOSIS', 'KAVA', 'AURORA', 'CRONOS', 'OKC',
  'HECO', 'EVM',
  // TigerSmartChain mainnet and testnet, and the chain's own ticker as a name.
  'TIGERSMARTCHAIN', 'TSC', 'TGR', 'TIGERSMARTCHAIN-TESTNET', 'TSC-TESTNET',
]);

/** Whether a network name denotes an EVM chain. */
export function isEvmChainNetwork(network: string): boolean {
  return EVM_CHAIN_NETWORKS.has(String(network ?? '').trim().toUpperCase());
}
