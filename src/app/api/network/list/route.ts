import { NextResponse } from 'next/server';

/**
 * Get Network List - Production Implementation
 * Returns supported blockchain networks
 */
export async function GET() {
  try {
    // Return real supported networks
    const networks = [
      // EVM Chains
      { id: 1, name: 'Ethereum', symbol: 'ETH', type: 'evm', chainId: 1, decimals: 18, explorer: 'https://etherscan.io', rpc: 'https://eth.llamarpc.com', status: 'active' },
      { id: 56, name: 'BNB Smart Chain', symbol: 'BNB', type: 'evm', chainId: 56, decimals: 18, explorer: 'https://bscscan.com', rpc: 'https://bsc-dataseed.binance.org', status: 'active' },
      { id: 137, name: 'Polygon', symbol: 'MATIC', type: 'evm', chainId: 137, decimals: 18, explorer: 'https://polygonscan.com', rpc: 'https://polygon-rpc.com', status: 'active' },
      { id: 42161, name: 'Arbitrum One', symbol: 'ETH', type: 'evm', chainId: 42161, decimals: 18, explorer: 'https://arbiscan.io', rpc: 'https://arb1.arbitrum.io/rpc', status: 'active' },
      { id: 10, name: 'Optimism', symbol: 'ETH', type: 'evm', chainId: 10, decimals: 18, explorer: 'https://optimistic.etherscan.io', rpc: 'https://mainnet.optimism.io', status: 'active' },
      { id: 8453, name: 'Base', symbol: 'ETH', type: 'evm', chainId: 8453, decimals: 18, explorer: 'https://basescan.org', rpc: 'https://mainnet.base.org', status: 'active' },
      { id: 43114, name: 'Avalanche C-Chain', symbol: 'AVAX', type: 'evm', chainId: 43114, decimals: 18, explorer: 'https://snowtrace.io', rpc: 'https://api.avax.network/ext/bc/C/rpc', status: 'active' },
      { id: 250, name: 'Fantom', symbol: 'FTM', type: 'evm', chainId: 250, decimals: 18, explorer: 'https://ftmscan.com', rpc: 'https://rpc.fantom.network', status: 'active' },
      { id: 1666600000, name: 'Harmony', symbol: 'ONE', type: 'evm', chainId: 1666600000, decimals: 18, explorer: 'https://explorer.harmony.one', rpc: 'https://api.harmony.one', status: 'active' },
      { id: 128, name: 'Huobi ECO Chain', symbol: 'HT', type: 'evm', chainId: 128, decimals: 18, explorer: 'https://hecoinfo.com', rpc: 'https://http-mainnet.hecochain.com', status: 'active' },
      { id: 66, name: 'OKX Chain', symbol: 'OKT', type: 'evm', chainId: 66, decimals: 18, explorer: 'https://www.oklink.com/oktc', rpc: 'https://exchainrpc.okex.org', status: 'active' },
      { id: 100, name: 'Gnosis Chain', symbol: 'xDAI', type: 'evm', chainId: 100, decimals: 18, explorer: 'https://gnosisscan.io', rpc: 'https://rpc.gnosischain.com', status: 'active' },
      { id: 1284, name: 'Moonbeam', symbol: 'GLMR', type: 'evm', chainId: 1284, decimals: 18, explorer: 'https://moonbeam.moonscan.io', rpc: 'https://rpc.api.moonbeam.network', status: 'active' },
      { id: 1285, name: 'Moonriver', symbol: 'MOVR', type: 'evm', chainId: 1285, decimals: 18, explorer: 'https://moonriver.moonscan.io', rpc: 'https://rpc.api.moonriver.network', status: 'active' },
      { id: 42220, name: 'Celo', symbol: 'CELO', type: 'evm', chainId: 42220, decimals: 18, explorer: 'https://explorer.celo.org', rpc: 'https://forno.celo.org', status: 'active' },
      
      // Bitcoin
      { id: 0, name: 'Bitcoin', symbol: 'BTC', type: 'bitcoin', decimals: 8, explorer: 'https://blockstream.info', rpc: 'https://blockstream.info/api', status: 'active' },
      { id: 0, name: 'Bitcoin Testnet', symbol: 'BTC', type: 'bitcoin', decimals: 8, explorer: 'https://blockstream.info/testnet', rpc: 'https://blockstream.info/testnet/api', status: 'testnet' },
      
      // Solana
      { id: 101, name: 'Solana', symbol: 'SOL', type: 'solana', decimals: 9, explorer: 'https://explorer.solana.com', rpc: 'https://api.mainnet-beta.solana.com', status: 'active' },
      { id: 102, name: 'Solana Devnet', symbol: 'SOL', type: 'solana', decimals: 9, explorer: 'https://explorer.solana.com/?cluster=devnet', rpc: 'https://api.devnet.solana.com', status: 'testnet' },
      
      // TON
      { id: -239, name: 'TON', symbol: 'TON', type: 'ton', decimals: 9, explorer: 'https://tonscan.org', rpc: 'https://toncenter.com/api/v2', status: 'active' },
      
      // Cosmos
      { id: 'cosmos', name: 'Cosmos', symbol: 'ATOM', type: 'cosmos', decimals: 6, explorer: 'https://mintscan.io/cosmos', rpc: 'https://cosmos-rpc.polkachu.com', status: 'active' },
      { id: 'osmosis', name: 'Osmosis', symbol: 'OSMO', type: 'cosmos', decimals: 6, explorer: 'https://mintscan.io/osmosis', rpc: 'https://osmosis-rpc.polkachu.com', status: 'active' },
      { id: 'secret', name: 'Secret Network', symbol: 'SCRT', type: 'cosmos', decimals: 6, explorer: 'https://mintscan.io/secret', rpc: 'https://secret-4-rpc.polkachu.com', status: 'active' },
      
      // Aptos
      { id: 1, name: 'Aptos', symbol: 'APT', type: 'aptos', decimals: 8, explorer: 'https://explorer.aptoslabs.com', rpc: 'https://api.mainnet.aptoslabs.com/v1', status: 'active' },
      
      // Near
      { id: 'mainnet', name: 'NEAR', symbol: 'NEAR', type: 'near', decimals: 24, explorer: 'https://explorer.near.org', rpc: 'https://rpc.mainnet.near.org', status: 'active' },
      
      // Algorand
      { id: 'mainnet', name: 'Algorand', symbol: 'ALGO', type: 'algorand', decimals: 6, explorer: 'https://algoexplorer.io', rpc: 'https://algoindexer.algocharts.io/v2', status: 'active' },
      
      // Polkadot
      { id: 'polkadot', name: 'Polkadot', symbol: 'DOT', type: 'polkadot', decimals: 10, explorer: 'https://polkadot.subscan.io', rpc: 'https://rpc.polkadot.io', status: 'active' },
      { id: 'kusama', name: 'Kusama', symbol: 'KSM', type: 'polkadot', decimals: 12, explorer: 'https://kusama.subscan.io', rpc: 'https://rpc.kusama.network', status: 'active' },
    ];

    return NextResponse.json({
      success: true,
      networks,
    });
  } catch (error: any) {
    console.error('Network list API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
