/**
 * TigerEx - React Integration Components
 * 
 * Complete React integration for TigerEx Platform
 * Supports: Wallet, Swap, Bridge, Staking
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { 
  tigerWallet, 
  TigerWallet, 
  SUPPORTED_CHAINS, 
  ChainConfig, 
  TokenConfig,
  TOKENS 
} from '../tiger_wallet';
import { 
  tigerswapDEX, 
  TigerswapDEX, 
  SwapQuote,
  Pool 
} from '../tiger_swap';
import { 
  tigerSmartChain, 
  TigerSmartChain,
  BridgeConfig 
} from '../tiger_smart_chain';
import { 
  feeCollector, 
  FeeCollector,
  FeeType 
} from '../fee_collection';

// ==================== Context Types ====================

interface WalletContextType {
  wallet: TigerWallet;
  address: string;
  chain: string;
  connected: boolean;
  balance: string;
  tokens: TokenConfig[];
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: (chainKey: string) => Promise<void>;
  getBalance: () => Promise<string>;
  sendTransaction: (to: string, amount: string) => Promise<string>;
}

interface SwapContextType {
  dex: TigerswapDEX;
  pools: Pool[];
  getQuote: (inputToken: string, outputToken: string, amount: string) => Promise<SwapQuote>;
  swap: (inputToken: string, outputToken: string, amount: string) => Promise<string>;
  addLiquidity: (params: any) => Promise<string>;
}

interface ChainContextType {
  chains: ChainConfig[];
  tokens: TokenConfig[];
  bridges: BridgeConfig[];
  tgrPrice: number;
  rusdPrice: number;
  getSupportedChains: () => ChainConfig[];
  getChainTokens: (chainKey: string) => TokenConfig[];
  getBridge: (sourceChain: string, targetChain: string) => BridgeConfig | null;
}

interface FeeContextType {
  feeCollector: FeeCollector;
  totalFees: Record<FeeType, string>;
  dailyFees: any[];
  recordFee: (type: FeeType, amount: string, chainKey: string) => void;
  getFeeSummary: () => any;
}

// ==================== Wallet Context ====================

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState('ethereum');
  const [connected, setConnected] = useState(false);
  const [balance, setBalance] = useState('0');
  const [tokens, setTokens] = useState<TokenConfig[]>([]);
  const [wallet] = useState(() => tigerWallet);

  useEffect(() => {
    const handleConnect = () => {
      setConnected(wallet.isConnected());
      if (wallet.isConnected()) {
        setAddress(wallet.getAddress());
        setChain(wallet.getChain());
      }
    };

    wallet.on('connected', handleConnect);
    wallet.on('disconnected', () => setConnected(false));
    wallet.on('chainChanged', setChain);

    return () => {
      // Cleanup listeners
    };
  }, [wallet]);

  const connect = useCallback(async () => {
    try {
      const addr = await wallet.connect();
      setAddress(addr);
      setConnected(true);
      setChain(wallet.getChain());
      
      // Get balance
      const bal = await wallet.getBalance();
      setBalance(bal);
    } catch (error) {
      console.error('Failed to connect:', error);
      throw error;
    }
  }, [wallet]);

  const disconnect = useCallback(() => {
    wallet.disconnect();
    setAddress('');
    setConnected(false);
    setBalance('0');
  }, [wallet]);

  const switchChain = useCallback(async (chainKey: string) => {
    await wallet.switchChain(chainKey);
    setChain(chainKey);
  }, [wallet]);

  const getBalance = useCallback(async () => {
    if (!connected) throw new Error('Wallet not connected');
    const bal = await wallet.getBalance();
    setBalance(bal);
    return bal;
  }, [wallet, connected]);

  const sendTransaction = useCallback(async (to: string, amount: string) => {
    if (!connected) throw new Error('Wallet not connected');
    return await wallet.sendTransaction(to, amount);
  }, [wallet, connected]);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        address,
        chain,
        connected,
        balance,
        tokens,
        connect,
        disconnect,
        switchChain,
        getBalance,
        sendTransaction
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}

// ==================== Swap Context ====================

const SwapContext = createContext<SwapContextType | null>(null);

export function SwapProvider({ children }: { children: ReactNode }) {
  const [pools, setPools] = useState<Pool[]>([]);
  const [dex] = useState(() => tigerswapDEX);

  useEffect(() => {
    // Load pools
    setPools(dex.getAllPools());
  }, [dex]);

  const getQuote = useCallback(async (
    inputToken: string, 
    outputToken: string, 
    amount: string
  ) => {
    return await dex.getQuote(inputToken, outputToken, amount);
  }, [dex]);

  const swap = useCallback(async (
    inputToken: string, 
    outputToken: string, 
    amount: string
  ) => {
    const quote = await dex.getQuote(inputToken, outputToken, amount);
    return await dex.swap(
      inputToken, 
      outputToken, 
      amount, 
      quote.minimumOutput,
      '',
      Math.floor(Date.now() / 1000) + 600
    );
  }, [dex]);

  const addLiquidity = useCallback(async (params: any) => {
    return await dex.addLiquidity(params);
  }, [dex]);

  return (
    <SwapContext.Provider
      value={{
        dex,
        pools,
        getQuote,
        swap,
        addLiquidity
      }}
    >
      {children}
    </SwapContext.Provider>
  );
}

export function useSwap() {
  const context = useContext(SwapContext);
  if (!context) {
    throw new Error('useSwap must be used within SwapProvider');
  }
  return context;
}

// ==================== Chain Context ====================

const ChainContext = createContext<ChainContextType | null>(null);

export function ChainProvider({ children }: { children: ReactNode }) {
  const [chains] = useState<ChainConfig[]>(() => 
    Object.values(SUPPORTED_CHAINS)
  );
  const [tokens] = useState<TokenConfig[]>(() => 
    Object.values(TOKENS)
  );
  const [bridges, setBridges] = useState<BridgeConfig[]>([]);
  const [tgrPrice, setTgrPrice] = useState(0.05);
  const [rusdPrice, setRusdPrice] = useState(1.0);

  useEffect(() => {
    // Load bridges
    setBridges(tigerSmartChain.getAllBridges());
    
    // Load prices
    setTgrPrice(tigerSmartChain.getTGRConfig().priceUSD);
    setRusdPrice(tigerSmartChain.getRUSDConfig().targetPeg);
  }, []);

  const getSupportedChains = useCallback(() => {
    return chains.filter(c => c.isActive);
  }, [chains]);

  const getChainTokens = useCallback((chainKey: string) => {
    return tokens.filter(t => t.chainKey === chainKey);
  }, [tokens]);

  const getBridge = useCallback((sourceChain: string, targetChain: string) => {
    return tigerSmartChain.getBridge(sourceChain, targetChain);
  }, []);

  return (
    <ChainContext.Provider
      value={{
        chains,
        tokens,
        bridges,
        tgrPrice,
        rusdPrice,
        getSupportedChains,
        getChainTokens,
        getBridge
      }}
    >
      {children}
    </ChainContext.Provider>
  );
}

export function useChain() {
  const context = useContext(ChainContext);
  if (!context) {
    throw new Error('useChain must be used within ChainProvider');
  }
  return context;
}

// ==================== Fee Context ====================

const FeeContext = createContext<FeeContextType | null>(null);

export function FeeProvider({ children }: { children: ReactNode }) {
  const [totalFees, setTotalFees] = useState<Record<FeeType, string>>({} as Record<FeeType, string>);
  const [dailyFees, setDailyFees] = useState<any[]>([]);

  useEffect(() => {
    // Load initial fees
    const summary = feeCollector.getFeeSummary();
    const summaryFormatted: Record<FeeType, string> = {} as Record<FeeType, string>;
    for (const [type, amount] of Object.entries(summary.breakdown)) {
      summaryFormatted[type as FeeType] = amount.toString();
    }
    setTotalFees(summaryFormatted);
    
    setDailyFees(feeCollector.getDailyStats());
  }, []);

  const recordFee = useCallback((
    type: FeeType, 
    amount: string, 
    chainKey: string
  ) => {
    feeCollector.recordFee(
      type,
      BigInt(amount),
      chainKey
    );
    
    // Update totals
    const summary = feeCollector.getFeeSummary();
    const summaryFormatted: Record<FeeType, string> = {} as Record<FeeType, string>;
    for (const [t, a] of Object.entries(summary.breakdown)) {
      summaryFormatted[t as FeeType] = a.toString();
    }
    setTotalFees(summaryFormatted);
  }, []);

  const getFeeSummary = useCallback(() => {
    return feeCollector.getFeeSummary();
  }, []);

  return (
    <FeeContext.Provider
      value={{
        feeCollector,
        totalFees,
        dailyFees,
        recordFee,
        getFeeSummary
      }}
    >
      {children}
    </FeeContext.Provider>
  );
}

export function useFee() {
  const context = useContext(FeeContext);
  if (!context) {
    throw new Error('useFee must be used within FeeProvider');
  }
  return context;
}

// ==================== Main Provider ====================

export function TigerExProvider({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <ChainProvider>
        <SwapProvider>
          <FeeProvider>
            {children}
          </FeeProvider>
        </SwapProvider>
      </ChainProvider>
    </WalletProvider>
  );
}

// ==================== Hooks ====================

export function useCrossChainSwap() {
  const { getBridge } = useChain();
  const { swap } = useSwap();

  const executeCrossChainSwap = useCallback(async (
    fromChain: string,
    toChain: string,
    inputToken: string,
    outputToken: string,
    amount: string
  ) => {
    // Check if bridge exists
    const bridge = getBridge(fromChain, toChain);
    if (!bridge) {
      throw new Error(`No bridge available from ${fromChain} to ${toChain}`);
    }

    // Execute swap
    const txHash = await swap(inputToken, outputToken, amount);
    return txHash;
  }, [getBridge, swap]);

  return { executeCrossChainSwap };
}

export function useStaking() {
  const { tgrPrice } = useChain();

  const calculateRewards = useCallback((
    stakedAmount: string,
    apr: number,
    days: number
  ) => {
    const amount = parseFloat(stakedAmount);
    const dailyRate = apr / 365;
    return (amount * dailyRate * days * tgrPrice).toFixed(2);
  }, [tgrPrice]);

  return { calculateRewards };
}

// Export all components
export default {
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
};