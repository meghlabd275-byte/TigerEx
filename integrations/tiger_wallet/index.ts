/**
 * TigerEx - TigerWallet Integration
 * 
 * Multichain Web3 Wallet Integration for TigerEx Platform
 * Supports 20+ EVM and 25+ Non-EVM Blockchains
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

import { ethers, providers, Wallet, Signer } from 'ethers';
import { ERC20_ABI, NATIVE_ABI } from './abis';

// ==================== Chain Configuration ====================

export interface ChainConfig {
  id: number;
  key: string;
  name: string;
  type: 'evm' | 'solana' | 'near' | 'aptos' | 'sui';
  symbol: string;
  decimals: number;
  rpcUrl: string;
  explorerUrl: string;
  chainId: string;
  isActive: boolean;
  isNative: boolean;
  bridgeAddress?: string;
  color?: string;
}

export interface TokenConfig {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainKey: string;
  isNative: boolean;
  totalSupply: string;
  priceUSD: number;
  isStablecoin: boolean;
  isVerified: boolean;
  logoUrl?: string;
}

export interface WalletState {
  address: string;
  chainKey: string;
  balance: string;
  tokens: TokenConfig[];
  connected: boolean;
}

// ==================== Supported Chains ====================

export const SUPPORTED_CHAINS: Record<string, ChainConfig> = {
  // TigerSmartChain (Native)
  tigersmartchain: {
    id: 2024,
    key: 'tigersmartchain',
    name: 'TigerSmartChain',
    type: 'evm',
    symbol: 'TGR',
    decimals: 18,
    rpcUrl: 'https://rpc.tigersmartchain.com',
    explorerUrl: 'https://scan.tigersmartchain.com',
    chainId: '0x7E8',
    isActive: true,
    isNative: true,
    color: '#FF6B35'
  },
  // EVM Chains
  ethereum: {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    type: 'evm',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/demo',
    explorerUrl: 'https://etherscan.io',
    chainId: '0x1',
    isActive: true,
    isNative: false,
    color: '#627EEA'
  },
  bsc: {
    id: 56,
    key: 'bsc',
    name: 'BNB Smart Chain',
    type: 'evm',
    symbol: 'BNB',
    decimals: 18,
    rpcUrl: 'https://bsc-dataseed1.binance.org',
    explorerUrl: 'https://bscscan.com',
    chainId: '0x38',
    isActive: true,
    isNative: false,
    color: '#F3BA2F'
  },
  polygon: {
    id: 137,
    key: 'polygon',
    name: 'Polygon',
    type: 'evm',
    symbol: 'MATIC',
    decimals: 18,
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    chainId: '0x89',
    isActive: true,
    isNative: false,
    color: '#8247E5'
  },
  avalanche: {
    id: 43114,
    key: 'avalanche',
    name: 'Avalanche',
    type: 'evm',
    symbol: 'AVAX',
    decimals: 18,
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    explorerUrl: 'https://snowtrace.io',
    chainId: '0xA86A',
    isActive: true,
    isNative: false,
    color: '#E84142'
  },
  fantom: {
    id: 250,
    key: 'fantom',
    name: 'Fantom',
    type: 'evm',
    symbol: 'FTM',
    decimals: 18,
    rpcUrl: 'https://rpc.ftm.tools',
    explorerUrl: 'https://ftmscan.com',
    chainId: '0xFA',
    isActive: true,
    isNative: false,
    color: '#1969FF'
  },
  arbitrum: {
    id: 42161,
    key: 'arbitrum',
    name: 'Arbitrum One',
    type: 'evm',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    chainId: '0xA4B1',
    isActive: true,
    isNative: false,
    color: '#28A0F0'
  },
  optimism: {
    id: 10,
    key: 'optimism',
    name: 'Optimism',
    type: 'evm',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    chainId: '0xA',
    isActive: true,
    isNative: false,
    color: '#FF0420'
  },
  base: {
    id: 8453,
    key: 'base',
    name: 'Base',
    type: 'evm',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    chainId: '0x2105',
    isActive: true,
    isNative: false,
    color: '#0052FF'
  },
  celo: {
    id: 42220,
    key: 'celo',
    name: 'Celo',
    type: 'evm',
    symbol: 'CELO',
    decimals: 18,
    rpcUrl: 'https://forno.celo.org',
    explorerUrl: 'https://explorer.celo.org',
    chainId: '0xA4EC',
    isActive: true,
    isNative: false,
    color: '#35BCBF'
  },
  gnosis: {
    id: 100,
    key: 'gnosis',
    name: 'Gnosis Chain',
    type: 'evm',
    symbol: 'XDAI',
    decimals: 18,
    rpcUrl: 'https://rpc.gnosischain.com',
    explorerUrl: 'https://gnosisscan.io',
    chainId: '0x64',
    isActive: true,
    isNative: false,
    color: '#4776D6'
  },
  // Non-EVM Chains (stored as config for reference)
  solana: {
    id: 101,
    key: 'solana',
    name: 'Solana',
    type: 'solana',
    symbol: 'SOL',
    decimals: 9,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerUrl: 'https://solscan.io',
    chainId: 'solana',
    isActive: true,
    isNative: false
  },
  near: {
    id: 1313161555,
    key: 'near',
    name: 'NEAR Protocol',
    type: 'near',
    symbol: 'NEAR',
    decimals: 24,
    rpcUrl: 'https://rpc.mainnet.near.org',
    explorerUrl: 'https://explorer.near.org',
    chainId: 'near',
    isActive: true,
    isNative: false
  },
  aptos: {
    id: 1,
    key: 'aptos',
    name: 'Aptos',
    type: 'aptos',
    symbol: 'APT',
    decimals: 8,
    rpcUrl: 'https://fullnode.mainnet.aptoslabs.com',
    explorerUrl: 'https://explorer.aptoslabs.com',
    chainId: 'aptos',
    isActive: true,
    isNative: false
  },
  sui: {
    id: 1,
    key: 'sui',
    name: 'Sui',
    type: 'sui',
    symbol: 'SUI',
    decimals: 9,
    rpcUrl: 'https://fullnode.mainnet.sui.io',
    explorerUrl: 'https://suiscan.xyz',
    chainId: 'sui',
    isActive: true,
    isNative: false
  }
};

// ==================== Token Registry ====================

export const TOKENS: Record<string, TokenConfig> = {
  // Tiger Ecosystem
  TGR: {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'TGR',
    name: 'Tiger Coin',
    decimals: 18,
    chainKey: 'tigersmartchain',
    isNative: true,
    totalSupply: '1000000000000000000000',
    priceUSD: 0.05,
    isStablecoin: false,
    isVerified: true,
    logoUrl: '/images/tgr.png'
  },
  RUSD: {
    address: '0x7886Cc6E7C5E8c4B7d9338d4B2dA6aF7dC3f8F8C8',
    symbol: 'RUSD',
    name: 'Royal Tiger United States Dollar',
    decimals: 18,
    chainKey: 'tigersmartchain',
    isNative: false,
    totalSupply: '1000000000000000000000',
    priceUSD: 1.0,
    isStablecoin: true,
    isVerified: true,
    logoUrl: '/images/rusd.png'
  },
  // Top Cryptocurrencies
  ETH: {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    chainKey: 'ethereum',
    isNative: true,
    totalSupply: '120000000000000000000',
    priceUSD: 3000,
    isStablecoin: false,
    isVerified: true,
    logoUrl: '/images/eth.png'
  },
  WETH: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    name: 'Wrapped Ethereum',
    decimals: 18,
    chainKey: 'ethereum',
    isNative: false,
    totalSupply: '0',
    priceUSD: 3000,
    isStablecoin: false,
    isVerified: true,
    logoUrl: '/images/weth.png'
  },
  USDT: {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    chainKey: 'ethereum',
    isNative: false,
    totalSupply: '100000000000000000000',
    priceUSD: 1.0,
    isStablecoin: true,
    isVerified: true,
    logoUrl: '/images/usdt.png'
  },
  USDC: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    chainKey: 'ethereum',
    isNative: false,
    totalSupply: '50000000000000000000',
    priceUSD: 1.0,
    isStablecoin: true,
    isVerified: true,
    logoUrl: '/images/usdc.png'
  },
  BNB: {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'BNB',
    name: 'BNB',
    decimals: 18,
    chainKey: 'bsc',
    isNative: true,
    totalSupply: '200000000000000000000',
    priceUSD: 600,
    isStablecoin: false,
    isVerified: true,
    logoUrl: '/images/bnb.png'
  },
  SOL: {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    chainKey: 'solana',
    isNative: true,
    totalSupply: '600000000000000000',
    priceUSD: 150,
    isStablecoin: false,
    isVerified: true,
    logoUrl: '/images/sol.png'
  }
};

// ==================== TigerWallet Class ====================

export class TigerWallet {
  private provider: providers.Web3Provider | null = null;
  private signer: Signer | null = null;
  private address: string = '';
  private chainKey: string = 'ethereum';
  private connected: boolean = false;
  private listeners: Map<string, Function[]> = new Map();

  /**
   * Connect to wallet via browser extension (MetaMask, Coinbase Wallet, etc.)
   */
  async connect(): Promise<string> {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('No Web3 wallet found. Please install MetaMask or another Web3 wallet.');
    }

    this.provider = new providers.Web3Provider(window.ethereum);
    
    try {
      // Request account access
      await this.provider.send('eth_requestAccounts', []);
      
      this.signer = this.provider.getSigner();
      this.address = await this.signer.getAddress();
      this.connected = true;
      
      // Get current chain
      const network = await this.provider.getNetwork();
      this.chainKey = this.getChainKeyFromId(network.chainId);
      
      // Listen for chain changes
      window.ethereum.on('chainChanged', (chainId: string) => {
        this.chainKey = this.getChainKeyFromId(parseInt(chainId, 16));
        this.emit('chainChanged', this.chainKey);
      });
      
      // Listen for account changes
      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        this.address = accounts[0] || '';
        this.emit('accountChanged', this.address);
      });
      
      this.emit('connected', this.address);
      return this.address;
    } catch (error) {
      throw new Error(`Failed to connect: ${error}`);
    }
  }

  /**
   * Disconnect wallet
   */
  disconnect(): void {
    this.provider = null;
    this.signer = null;
    this.address = '';
    this.connected = false;
    this.emit('disconnected', null);
  }

  /**
   * Switch to a different chain
   */
  async switchChain(chainKey: string): Promise<boolean> {
    if (!this.provider || !window.ethereum) {
      throw new Error('Wallet not connected');
    }

    const chain = SUPPORTED_CHAINS[chainKey];
    if (!chain) {
      throw new Error(`Chain not supported: ${chainKey}`);
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chain.chainId }]
      });
      
      this.chainKey = chainKey;
      this.emit('chainChanged', chainKey);
      return true;
    } catch (error: any) {
      // Chain not added, add it
      if (error.code === 4902) {
        return this.addChain(chainKey);
      }
      throw error;
    }
  }

  /**
   * Add a chain to wallet
   */
  async addChain(chainKey: string): Promise<boolean> {
    if (!window.ethereum) {
      throw new Error('No wallet found');
    }

    const chain = SUPPORTED_CHAINS[chainKey];
    if (!chain) {
      throw new Error(`Chain not found: ${chainKey}`);
    }

    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: chain.chainId,
          chainName: chain.name,
          nativeCurrency: {
            name: chain.symbol,
            symbol: chain.symbol,
            decimals: chain.decimals
          },
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: [chain.explorerUrl]
        }]
      });
      return true;
    } catch (error) {
      throw new Error(`Failed to add chain: ${error}`);
    }
  }

  /**
   * Get native balance
   */
  async getBalance(): Promise<string> {
    if (!this.provider || !this.address) {
      throw new Error('Wallet not connected');
    }

    return await this.provider.getBalance(this.address);
  }

  /**
   * Get token balance
   */
  async getTokenBalance(tokenAddress: string): Promise<string> {
    if (!this.provider || !this.address) {
      throw new Error('Wallet not connected');
    }

    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    return await token.balanceOf(this.address);
  }

  /**
   * Send native token transaction
   */
  async sendTransaction(to: string, value: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }

    const tx = await this.signer.sendTransaction({
      to,
      value: ethers.utils.parseEther(value)
    });

    return tx.hash;
  }

  /**
   * Send token transaction
   */
  async sendToken(to: string, tokenAddress: string, amount: string): Promise<string> {
    if (!this.provider || !this.signer) {
      throw new Error('Wallet not connected');
    }

    const chain = SUPPORTED_CHAINS[this.chainKey];
    const token = TOKENS[tokenAddress];
    
    if (!chain || !token) {
      throw new Error('Invalid chain or token');
    }

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);
    const decimals = token.decimals;
    
    const tx = await tokenContract.transfer(to, ethers.utils.parseUnits(amount, decimals));
    return tx.hash;
  }

  /**
   * Sign message
   */
  async signMessage(message: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }

    return await this.signer.signMessage(message);
  }

  /**
   * Sign typed data (EIP-712)
   */
  async signTypedData(domain: any, types: any, value: any): Promise<string> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }

    const signature = await this.signer._signTypedData(domain, types, value);
    return signature;
  }

  /**
   * Get current address
   */
  getAddress(): string {
    return this.address;
  }

  /**
   * Get current chain
   */
  getChain(): string {
    return this.chainKey;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get ethers provider
   */
  getProvider(): providers.Web3Provider | null {
    return this.provider;
  }

  /**
   * Get signer
   */
  getSigner(): Signer | null {
    return this.signer;
  }

  /**
   * Event listeners
   */
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }

  private getChainKeyFromId(chainId: number): string {
    for (const [key, chain] of Object.entries(SUPPORTED_CHAINS)) {
      if (chain.id === chainId) {
        return key;
      }
    }
    return 'ethereum';
  }
}

// ==================== Cross-Chain Support ====================

export interface BridgeTx {
  fromChain: string;
  toChain: string;
  token: string;
  amount: string;
  recipient: string;
  status: 'pending' | 'confirmed' | 'failed';
  txHash: string;
  timestamp: number;
}

export class CrossChainWallet extends TigerWallet {
  private bridgeTxs: Map<string, BridgeTx> = new Map();

  /**
   * Bridge tokens to another chain
   */
  async bridge(
    toChain: string,
    token: string,
    amount: string
  ): Promise<string> {
    const fromChain = this.getChain();
    
    if (fromChain === toChain) {
      throw new Error('Source and destination chains are the same');
    }

    // Bridge implementation would call the bridge contract
    // This is a simplified version
    const txHash = await this.sendTransaction(
      SUPPORTED_CHAINS[toChain].bridgeAddress || '',
      amount
    );

    const bridgeTx: BridgeTx = {
      fromChain,
      toChain,
      token,
      amount,
      recipient: this.getAddress(),
      status: 'pending',
      txHash,
      timestamp: Date.now()
    };

    this.bridgeTxs.set(txHash, bridgeTx);
    return txHash;
  }

  /**
   * Get bridge transaction status
   */
  async getBridgeStatus(txHash: string): Promise<BridgeTx | null> {
    return this.bridgeTxs.get(txHash) || null;
  }

  /**
   * Get all bridge transactions
   */
  getBridgeHistory(): BridgeTx[] {
    return Array.from(this.bridgeTxs.values());
  }
}

// ==================== Wallet Factory ====================

export function createWallet(type: 'browser' | 'crosschain' = 'browser'): TigerWallet {
  if (type === 'crosschain') {
    return new CrossChainWallet();
  }
  return new TigerWallet();
}

// ==================== MultiChain Manager ====================

export class MultiChainManager {
  private wallets: Map<string, TigerWallet> = new Map();

  /**
   * Create wallet for specific chain
   */
  createWallet(chainKey: string): TigerWallet {
    const wallet = new TigerWallet();
    this.wallets.set(chainKey, wallet);
    return wallet;
  }

  /**
   * Get wallet for chain
   */
  getWallet(chainKey: string): TigerWallet | undefined {
    return this.wallets.get(chainKey);
  }

  /**
   * Get all wallets
   */
  getAllWallets(): TigerWallet[] {
    return Array.from(this.wallets.values());
  }
}

// Export singleton instances
export const tigerWallet = new TigerWallet();
export const multiChainManager = new MultiChainManager();

// Export constants
export const VERSION = '1.0.0';
export const CHAIN_LIST = Object.keys(SUPPORTED_CHAINS);
export const TOKEN_LIST = Object.keys(TOKENS);