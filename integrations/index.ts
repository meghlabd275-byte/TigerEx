/**
 * TigerEx - Unified Integration Layer
 * 
 * Complete integration of TigerWallet, Tigerswap, TigerSmartChain, and Fee Collection
 * into the TigerEx platform with maximum fee collection.
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

// ==================== Re-exports ====================

// TigerWallet (Multichain Web3 Wallet)
export { 
  TigerWallet, 
  CrossChainWallet,
  MultiChainManager,
  createWallet,
  tigerWallet,
  multiChainManager,
  SUPPORTED_CHAINS,
  TOKENS,
  ChainConfig,
  TokenConfig,
  WalletState,
  VERSION as WALLET_VERSION
} from './tiger_wallet';

// Tigerswap (Multichain DEX)
export { 
  TigerswapDEX, 
  DEXAggregator,
  LiquidityManager,
  createDEX,
  tigerswapDEX,
  dexAggregator,
  Pool,
  Farm,
  SwapQuote,
  SwapRoute,
  AddLiquidityParams,
  RemoveLiquidityParams,
  VERSION as DEX_VERSION,
  DEFAULT_FEE,
  PLATFORM_FEE
} from './tiger_swap';

// TigerSmartChain (EVM Blockchain)
export { 
  TigerSmartChain, 
  TigerScan,
  createTigerSmartChain,
  createTigerScan,
  tigerSmartChain,
  tigerScan,
  TGRConfig,
  RUSDConfig,
  BridgeConfig,
  ValidatorConfig,
  CHAIN_ID,
  NATIVE_SYMBOL,
  STABLECOIN_SYMBOL,
  VERSION as CHAIN_VERSION
} from './tiger_smart_chain';

// Fee Collection System
export { 
  FeeCollector, 
  FeeDistributor,
  createFeeCollector,
  feeCollector,
  FeeType,
  Fee,
  FeeSummary,
  DailyFeeStats,
  FeeCollectorConfig,
  VERSION as FEE_VERSION,
  DEFAULT_FEES
} from './fee_collection';

// React Components
export { 
  TigerExProvider,
  WalletProvider,
  ChainProvider,
  SwapProvider,
  FeeProvider,
  useWallet,
  useSwap,
  useChain,
  useFee,
  useCrossChainSwap,
  useStaking
} from './tiger_ex_react';

// ==================== Product Configuration ====================

/**
 * TigerEx Platform Configuration
 */
export interface TigerExConfig {
  // Platform settings
  platformName: string;
  platformVersion: string;
  
  // Fee configuration
  exchangeFeePercent: number;
  dexSwapFeePercent: number;
  bridgeFeePercent: number;
  walletFeePercent: number;
  
  // Platform fee share (percentage of fees kept by platform)
  platformFeeShare: number;
  
  // Supported chains count
  evmChains: number;
  nonevmChains: number;
  
  // Token count
  supportedTokens: number;
}

/**
 * Get TigerEx platform configuration
 */
export function getTigerExConfig(): TigerExConfig {
  return {
    platformName: 'TigerEx',
    platformVersion: '1.0.0',
    
    // Fee percentages
    exchangeFeePercent: 0.001,   // 0.1%
    dexSwapFeePercent: 0.003,    // 0.3%
    bridgeFeePercent: 0.001,     // 0.1%
    walletFeePercent: 0.0001,    // 0.0001 TGR
    
    // Platform share
    platformFeeShare: 0.15,    // 15%
    
    // Chain counts
    evmChains: 24,
    nonevmChains: 26,
    
    // Token count
    supportedTokens: 200
  };
}

// ==================== Supported Chains ====================

/**
 * Complete list of supported EVM chains
 */
export const EVM_CHAINS = [
  'tigersmartchain', // Native - TigerSmartChain
  'ethereum',       // Ethereum
  'bsc',          // BNB Smart Chain
  'polygon',       // Polygon/zkEVM
  'avalanche',    // Avalanche
  'fantom',       // Fantom
  'arbitrum',     // Arbitrum One
  'optimism',     // Optimism
  'base',        // Base
  'celo',        // Celo
  'gnosis',       // Gnosis Chain
  'moonbeam',     // Moonbeam
  'moonriver',    // Moonriver
  'astar',       // Astar
  'shibuya',     // Shibuya (Testnet)
  'zkSyncEra',    // zkSync Era
  'linea',       // Linea
  'polygonZKEVM', // Polygon zkEVM
  'core',        // Core DAO
  'pulsechain',   // PulseChain
  'kcc',        // KuCoin Community Chain
  'heco',       // Huobi ECO Chain
  'okc',         // OKEx Chain
  'cronos',       // Cronos
  'arbitrumNova' // Arbitrum Nova
] as const;

/**
 * Complete list of supported Non-EVM chains
 */
export const NONEVM_CHAINS = [
  'solana',       // Solana
  'near',        // NEAR Protocol
  'algorand',    // Algorand
  'aptos',       // Aptos
  'sui',         // Sui
  'cosmos',      // Cosmos Hub
  'osmosis',     // Osmosis DEX
  'juno',       // Juno
  'injective',   // Injective
  'sei',         // Sei
  'ton',        // TON (Telegram Open Network)
  'radix',      // Radix
  'flow',        // Flow
  'hedera',     // Hedera Hashgraph
  'icon',       // ICON
  'vechain',     // VeChain
  'theta',      // Theta Network
  'multiversX', // MultiversX (Elrond)
  'kusama',     // Kusama
  'polkadot',   // Polkadot
  'cardano',    // Cardano
  'tezos',     // Tezos
  'stellar',   // Stellar
  'ripple',    // XRP
  'cosmos',    // Cosmos
  'secret'     // Secret Network
] as const;

/**
 * Get total supported chain count
 */
export function getTotalSupportedChains(): number {
  return EVM_CHAINS.length + NONEVM_CHAINS.length;
}

// ==================== Token Lists ====================

/**
 * Tiger Ecosystem tokens
 */
export const TIGER_TOKENS = {
  TGR: {
    symbol: 'TGR',
    name: 'Tiger Coin',
    decimals: 18,
    type: 'native',
    priceUSD: 0.05,
    isStablecoin: false,
    isVerified: true
  },
  RUSD: {
    symbol: 'RUSD',
    name: 'Royal Tiger United States Dollar',
    decimals: 18,
    type: 'stablecoin',
    priceUSD: 1.0,
    isStablecoin: true,
    isVerified: true
  }
} as const;

/**
 * Major stablecoins
 */
export const STABLECOINS = [
  'USDT',  // Tether USD
  'USDC',  // USD Coin
  'DAI',   // Dai
  'BUSD',  // Binance USD
  'TUSD',  // True USD
  'USDP',  // Pax Dollar
  'FRAX',  // Frax
  'RUSD'   // Royal Tiger USD
] as const;

/**
 * Top cryptocurrencies by market cap
 */
export const TOP_TOKENS = [
  'ETH',   // Ethereum
  'BNB',   // BNB
  'SOL',   // Solana
  'MATIC', // Polygon
  'AVAX',  // Avalanche
  'FTM',   // Fantom
  'ARB',   // Arbitrum
  'OP',    // Optimism
  'WBTC',  // Wrapped Bitcoin
  'AAVE',  // Aave
  'UNI',   // Uniswap
  'LINK',  // Chainlink
  'COMP',  // Compound
  'MKR',   // Maker
  'CRV',   // Curve DAO
  'LDO',   // Lido
  'SUSHI', // SushiSwap
  'RUNE',  // THORChain
  'SNX',   // Synthetix
  'YFI'   // Yearn Finance
] as const;

// ==================== Default Pools ====================

/**
 * Default DEX liquidity pools
 */
export const DEFAULT_POOLS = [
  { tokenA: 'TGR', tokenB: 'USDT', chain: 'tigersmartchain', fee: 0.003 },
  { tokenA: 'TGR', tokenB: 'RUSD', chain: 'tigersmartchain', fee: 0.003 },
  { tokenA: 'TGR', tokenB: 'ETH', chain: 'tigersmartchain', fee: 0.003 },
  { tokenA: 'RUSD', tokenB: 'USDT', chain: 'tigersmartchain', fee: 0.003 },
  { tokenA: 'ETH', tokenB: 'USDT', chain: 'ethereum', fee: 0.003 },
  { tokenA: 'BNB', tokenB: 'USDT', chain: 'bsc', fee: 0.003 },
  { tokenA: 'SOL', tokenB: 'USDT', chain: 'solana', fee: 0.003 },
  { tokenA: 'BTC', tokenB: 'USDT', chain: 'ethereum', fee: 0.003 }
] as const;

// ==================== Default Bridges ====================

/**
 * Default cross-chain bridges
 */
export const DEFAULT_BRIDGES = [
  { source: 'tigersmartchain', target: 'ethereum', minAmount: '0.1', maxAmount: '100000', feePercent: 0.1, timeEstimate: 300 },
  { source: 'tigersmartchain', target: 'bsc', minAmount: '0.1', maxAmount: '100000', feePercent: 0.1, timeEstimate: 300 },
  { source: 'tigersmartchain', target: 'polygon', minAmount: '0.1', maxAmount: '100000', feePercent: 0.1, timeEstimate: 300 },
  { source: 'tigersmartchain', target: 'avalanche', minAmount: '0.1', maxAmount: '100000', feePercent: 0.1, timeEstimate: 300 },
  { source: 'tigersmartchain', target: 'arbitrum', minAmount: '0.1', maxAmount: '100000', feePercent: 0.1, timeEstimate: 600 },
  { source: 'tigersmartchain', target: 'optimism', minAmount: '0.1', maxAmount: '100000', feePercent: 0.1, timeEstimate: 600 },
  { source: 'tigersmartchain', target: 'base', minAmount: '0.1', maxAmount: '100000', feePercent: 0.1, timeEstimate: 300 },
  { source: 'tigersmartchain', target: 'solana', minAmount: '0.1', maxAmount: '100000', feePercent: 0.15, timeEstimate: 900 }
] as const;

// ==================== Fee Collection Summary ====================

/**
 * Get complete fee summary for all products
 */
export interface TotalFeeSummary {
  exchange: string;
  dex: string;
  bridge: string;
  wallet: string;
  staking: string;
  platform: string;
  total: string;
}

/**
 * Platform revenue distribution
 */
export interface RevenueDistribution {
  platform: string;   // 15%
  team: string;      // 10%
  rewards: string;  // 25%
  treasury: string; // 50%
}

// ==================== Utility Functions ====================

/**
 * Format token amount with decimals
 */
export function formatTokenAmount(amount: string | bigint, decimals: number = 18): string {
  const amountStr = typeof amount === 'bigint' ? amount.toString() : amount;
  const value = BigInt(amountStr);
  const divisor = BigInt(10) ** BigInt(decimals);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;
  return `${integerPart}.${fractionalPart.toString().padStart(decimals, '0')}`;
}

/**
 * Parse token amount to raw value
 */
export function parseTokenAmount(amount: string, decimals: number = 18): bigint {
  const [integerPart, fractionalPart = ''] = amount.split('.');
  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(integerPart + paddedFractional);
}

/**
 * Calculate swap output with fees
 */
export function calculateSwapOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feePercent: number = 0.003
): bigint {
  const amountInWithFee = amountIn * BigInt(Math.floor((1 - feePercent) * 10000)) / BigInt(10000);
  return (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
}

/**
 * Calculate price impact
 */
export function calculatePriceImpact(
  amountIn: bigint,
  reserveIn: bigint
): number {
  const inFloat = Number(amountIn) / 1e18;
  const reserveFloat = Number(reserveIn) / 1e18;
  return (inFloat / reserveFloat) * 100;
}

/**
 * Calculate bridge fee
 */
export function calculateBridgeFee(
  amount: bigint,
  feePercent: number = 0.001,
  minFee: bigint = BigInt(1e17) // 0.0001 TGR
): bigint {
  const percentFee = (amount * BigInt(Math.floor(feePercent * 10000)) / BigInt(10000);
  return percentFee > minFee ? percentFee : minFee;
}

// ==================== Version Information ====================

export const VERSION = '1.0.0';
export const PLATFORM = 'TigerEx';
export const BUILD_DATE = new Date().toISOString();

/**
 * Get platform information
 */
export function getPlatformInfo() {
  return {
    name: PLATFORM,
    version: VERSION,
    chains: {
      evm: EVM_CHAINS.length,
      nonevm: NONEVM_CHAINS.length,
      total: getTotalSupportedChains()
    },
    tokens: {
      tiger: Object.keys(TIGER_TOKENS).length,
      stablecoins: STABLECOINS.length,
      top: TOP_TOKENS.length,
      total: 200
    },
    pools: DEFAULT_POOLS.length,
    bridges: DEFAULT_BRIDGES.length,
    buildDate: BUILD_DATE
  };
}

// ==================== Initialize ====================

/**
 * Initialize all TigerEx integrations
 * This should be called once at application startup
 */
export async function initializeTigerEx(): Promise<{
  wallet: typeof tigerWallet;
  dex: typeof tigerswapDEX;
  chain: typeof tigerSmartChain;
  fees: typeof feeCollector;
}> {
  console.log('Initializing TigerEx Integration Layer...');
  console.log(`Platform: ${PLATFORM} v${VERSION}`);
  console.log(`Supported Chains: ${getTotalSupportedChains()}`);
  
  // In production, you would initialize actual providers here
  // For now, we just return the singleton instances
  
  return {
    wallet: tigerWallet,
    dex: tigerswapDEX,
    chain: tigerSmartChain,
    fees: feeCollector
  };
}

// Export everything as default
export default {
  // Core exports
  TigerExProvider,
  getTigerExConfig,
  getPlatformInfo,
  initializeTigerEx,
  
  // Version
  VERSION,
  PLATFORM,
  BUILD_DATE
};