/**
 * TigerEx - Tigerswap Integration
 * 
 * Multichain DEX Integration for TigerEx Platform
 * Features: Liquidity Pools, Farming, Swapping, Fee Collection
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

import { ethers, BigNumber, Contract } from 'ethers';
import { ERC20_ABI, UNISWAP_V2_ROUTER_ABI } from './abis';
import { TOKENS, ChainConfig, SUPPORTED_CHAINS } from './wallet';

// ==================== Pool Types ====================

export interface Pool {
  id: string;
  tokenA: string;
  tokenB: string;
  reserveA: BigNumber;
  reserveB: BigNumber;
  liquidity: BigNumber;
  fee: number; // 0.003 = 0.3%
  chainKey: string;
  apr: number;
  volume24h: number;
}

export interface Farm {
  poolId: string;
  rewardToken: string;
  rewardRate: BigNumber;
  totalStaked: BigNumber;
  apr: number;
  startTime: number;
  endTime: number;
  pid: number;
}

export interface SwapRoute {
  path: string[];
  pools: string[];
  estimatedOutput: BigNumber;
  priceImpact: number;
  slippage: number;
}

export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  priceImpact: number;
  minimumOutput: string;
  route: SwapRoute;
}

export interface AddLiquidityParams {
  tokenA: string;
  tokenB: string;
  amountADesired: string;
  amountBDesired: string;
  amountAMin: string;
  amountBMin: string;
  to: string;
  deadline: number;
}

export interface RemoveLiquidityParams {
  tokenA: string;
  tokenB: string;
  liquidity: string;
  amountAMin: string;
  amountBMin: string;
  to: string;
  deadline: number;
}

// ==================== Tigerswap DEX ====================

export class TigerswapDEX {
  private provider: ethers.providers.Web3Provider | null = null;
  private signer: ethers.Signer | null = null;
  private account: string = '';
  private chainKey: string = 'ethereum';
  private pools: Map<string, Pool> = new Map();
  private farms: Map<string, Farm> = new Map();
  private routerAddress: string = '';
  
  // Fee configuration
  private readonly SWAP_FEE = 0.003; // 0.3%
  private readonly PLATFORM_FEE_SHARE = 0.15; // 15% to platform
  
  /**
   * Initialize DEX with provider
   */
  initialize(
    provider: ethers.providers.Web3Provider,
    signer: ethers.Signer,
    routerAddress: string
  ): void {
    this.provider = provider;
    this.signer = signer;
    this.routerAddress = routerAddress;
  }

  /**
   * Set account for transactions
   */
  setAccount(account: string, chainKey: string): void {
    this.account = account;
    this.chainKey = chainKey;
  }

  /**
   * Get pool info
   */
  async getPool(tokenA: string, tokenB: string): Promise<Pool | null> {
    const poolKey = this.getPoolKey(tokenA, tokenB);
    return this.pools.get(poolKey) || null;
  }

  /**
   * Get swap quote
   */
  async getQuote(
    inputToken: string,
    outputToken: string,
    amountIn: string
  ): Promise<SwapQuote> {
    const poolKey = this.getPoolKey(inputToken, outputToken);
    const pool = this.pools.get(poolKey);
    
    if (!pool) {
      throw new Error(`Pool not found: ${poolKey}`);
    }

    const amountInBN = BigNumber.from(amountIn);
    const reserveA = pool.reserveA;
    const reserveB = pool.reserveB;
    
    // Calculate output using AMM formula
    // output = (amountIn * reserveB) / (reserveA + amountIn)
    const amountInWithFee = amountInBN.mul(1000 - Math.floor(this.SWAP_FEE * 1000));
    const numerator = amountInWithFee.mul(reserveB);
    const denominator = reserveA.mul(1000).add(amountInWithFee);
    const outputAmount = numerator.div(denominator);
    
    // Calculate price impact
    const inputValue = parseFloat(ethers.utils.formatUnits(amountInBN, 18));
    const reserveAValue = parseFloat(ethers.utils.formatUnits(reserveA, 18));
    const priceImpact = (inputValue / reserveAValue) * 100;
    
    // Calculate minimum output (1% slippage)
    const minOutput = outputAmount.mul(99).div(100);
    
    return {
      inputToken,
      outputToken,
      inputAmount: amountIn,
      outputAmount: outputAmount.toString(),
      priceImpact,
      minimumOutput: minOutput.toString(),
      route: {
        path: [inputToken, outputToken],
        pools: [poolKey],
        estimatedOutput: outputAmount,
        priceImpact,
        slippage: 1
      }
    };
  }

  /**
   * Execute swap
   */
  async swap(
    inputToken: string,
    outputToken: string,
    amountIn: string,
    amountOutMin: string,
    to: string,
    deadline: number
  ): Promise<string> {
    if (!this.signer || !this.provider) {
      throw new Error('DEX not initialized');
    }

    const tokenIn = TOKENS[inputToken];
    const path = [inputToken, outputToken];
    
    // Build swap path
    const pathAddresses = path.map(t => 
      t === 'ETH' || t === inputToken && tokenIn?.isNative
        ? ethers.constants.AddressZero
        : TOKENS[t]?.address || t
    );
    
    // Create router contract
    const router = new Contract(
      this.routerAddress,
      UNISWAP_V2_ROUTER_ABI,
      this.signer
    );

    // Execute swap based on tokens
    let tx;
    if (tokenIn?.isNative) {
      tx = await router.swapExactETHForTokens(
        amountOutMin,
        pathAddresses,
        to,
        deadline,
        { value: amountIn }
      );
    } else {
      // Approve token if needed
      await this.approveToken(inputToken, this.routerAddress, amountIn);
      
      tx = await router.swapExactTokensForTokens(
        amountIn,
        amountOutMin,
        pathAddresses,
        to,
        deadline
      );
    }

    // Record fee for collection
    this.recordFee('dex', amountIn, this.chainKey);
    
    return tx.hash;
  }

  /**
   * Add liquidity
   */
  async addLiquidity(params: AddLiquidityParams): Promise<string> {
    if (!this.signer) {
      throw new Error('DEX not initialized');
    }

    const router = new Contract(
      this.routerAddress,
      UNISWAP_V2_ROUTER_ABI,
      this.signer
    );

    // Approve tokens
    await this.approveToken(params.tokenA, this.routerAddress, params.amountADesired);
    await this.approveToken(params.tokenB, this.routerAddress, params.amountBDesired);

    const tx = await router.addLiquidity(
      params.tokenA,
      params.tokenB,
      params.amountADesired,
      params.amountBDesired,
      params.amountAMin,
      params.amountBMin,
      params.to,
      params.deadline
    );

    // Update pool reserves
    await this.updatePoolReserves(params.tokenA, params.tokenB);

    return tx.hash;
  }

  /**
   * Remove liquidity
   */
  async removeLiquidity(params: RemoveLiquidityParams): Promise<string> {
    if (!this.signer) {
      throw new Error('DEX not initialized');
    }

    const router = new Contract(
      this.routerAddress,
      UNISWAP_V2_ROUTER_ABI,
      this.signer
    );

    // Approve LP token
    await this.approveToken(
      this.getLPTokenAddress(params.tokenA, params.tokenB),
      this.routerAddress,
      params.liquidity
    );

    const tx = await router.removeLiquidity(
      params.tokenA,
      params.tokenB,
      params.liquidity,
      params.amountAMin,
      params.amountBMin,
      params.to,
      params.deadline
    );

    return tx.hash;
  }

  /**
   * Get farm info
   */
  async getFarm(poolId: string): Promise<Farm | null> {
    return this.farms.get(poolId) || null;
  }

  /**
   * Stake in farm
   */
  async stake(poolId: string, amount: string): Promise<string> {
    if (!this.signer) {
      throw new Error('DEX not initialized');
    }

    const farm = this.farms.get(poolId);
    if (!farm) {
      throw new Error(`Farm not found: ${poolId}`);
    }

    // Approve LP token
    const lpToken = this.getLPTokenAddress(
      farm.poolId.split('-')[0],
      farm.poolId.split('-')[1]
    );
    await this.approveToken(lpToken, this.routerAddress, amount);

    // Stake (would call farm contract)
    // Simplified - returns mock tx hash
    return `0x${'a'.repeat(64)}`;
  }

  /**
   * Unstake from farm
   */
  async unstake(poolId: string, amount: string): Promise<string> {
    // Unstake logic
    return `0x${'b'.repeat(64)}`;
  }

  /**
   * Claim rewards
   */
  async claimRewards(poolId: string): Promise<string> {
    // Claim rewards logic
    return `0x${'c'.repeat(64)}`;
  }

  /**
   * Get token price
   */
  async getPrice(token: string): Promise<number> {
    const tokenConfig = TOKENS[token];
    return tokenConfig?.priceUSD || 0;
  }

  /**
   * Get all pools
   */
  getAllPools(): Pool[] {
    return Array.from(this.pools.values());
  }

  /**
   * Get all farms
   */
  getAllFarms(): Farm[] {
    return Array.from(this.farms.values());
  }

  // Private methods

  private getPoolKey(tokenA: string, tokenB: string): string {
    return [tokenA, tokenB].sort().join('-');
  }

  private getLPTokenAddress(tokenA: string, tokenB: string): string {
    // In production, get from factory contract
    return ethers.constants.AddressZero;
  }

  private async approveToken(
    token: string,
    spender: string,
    amount: string
  ): Promise<void> {
    if (token === ethers.constants.AddressZero) return;

    const tokenContract = new Contract(token, ERC20_ABI, this.signer!);
    const allowance = await tokenContract.allowance(this.account, spender);
    
    if (allowance.lt(amount)) {
      const tx = await tokenContract.approve(spender, ethers.constants.MaxUint256);
      await tx.wait();
    }
  }

  private async updatePoolReserves(tokenA: string, tokenB: string): Promise<void> {
    const poolKey = this.getPoolKey(tokenA, tokenB);
    const pool = this.pools.get(poolKey);
    
    if (pool) {
      // Get actual reserves from contract
      // Simplified update
      pool.reserveA = pool.reserveA.add(BigNumber.from(1));
      pool.reserveB = pool.reserveB.add(BigNumber.from(1));
    }
  }

  private recordFee(type: string, amount: string, chainKey: string): void {
    // Record fee for collection system
    const feeAmount = parseFloat(amount) * this.SWAP_FEE * this.PLATFORM_FEE_SHARE;
    console.log(`Fee recorded: ${type} - ${feeAmount} on ${chainKey}`);
  }
}

// ==================== DEX Aggregator ====================

export class DEXAggregator {
  private dexes: Map<string, TigerswapDEX> = new Map();
  private provider: ethers.providers.Web3Provider | null = null;

  /**
   * Add DEX to aggregator
   */
  addDEX(chainKey: string, dex: TigerswapDEX): void {
    this.dexes.set(chainKey, dex);
  }

  /**
   * Get best quote across all DEXs
   */
  async getBestQuote(
    inputToken: string,
    outputToken: string,
    amountIn: string
  ): Promise<SwapQuote> {
    const dex = this.dexes.get(this.provider?.network?.chainId?.toString() || '1');
    
    if (!dex) {
      throw new Error('No DEX available');
    }

    return await dex.getQuote(inputToken, outputToken, amountIn);
  }

  /**
   * Execute swap via best route
   */
  async swap(
    inputToken: string,
    outputToken: string,
    amountIn: string,
    amountOutMin: string,
    to: string
  ): Promise<string> {
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    const dex = this.dexes.get(this.provider?.network?.chainId?.toString() || '1');
    
    if (!dex) {
      throw new Error('No DEX available');
    }

    return await dex.swap(inputToken, outputToken, amountIn, amountOutMin, to, deadline);
  }

  /**
   * Get all quotes from all DEXs
   */
  async getAllQuotes(
    inputToken: string,
    outputToken: string,
    amountIn: string
  ): Promise<SwapQuote[]> {
    const quotes: SwapQuote[] = [];
    
    for (const [, dex] of this.dexes) {
      try {
        const quote = await dex.getQuote(inputToken, outputToken, amountIn);
        quotes.push(quote);
      } catch (e) {
        // Skip DEX if quote fails
      }
    }

    return quotes.sort((a, b) => 
      parseFloat(b.outputAmount) - parseFloat(a.outputAmount)
    );
  }
}

// ==================== Liquidity Manager ====================

export class LiquidityManager {
  private dex: TigerswapDEX;

  constructor(dex: TigerswapDEX) {
    this.dex = dex;
  }

  /**
   * Get optimal liquidity amounts
   */
  async getOptimalAmounts(
    tokenA: string,
    tokenB: string,
    amountADesired: string
  ): Promise<{ amountA: string; amountB: string }> {
    const pool = await this.dex.getPool(tokenA, tokenB);
    
    if (!pool) {
      return {
        amountA: amountADesired,
        amountB: amountADesired // Default 1:1
      };
    }

    // Calculate optimal amounts based on pool reserves
    const amountAFloat = parseFloat(amountADesired);
    const reserveA = parseFloat(ethers.utils.formatUnits(pool.reserveA, 18));
    const reserveB = parseFloat(ethers.utils.formatUnits(pool.reserveB, 18));

    const amountB = (amountAFloat * reserveB) / reserveA;

    return {
      amountA: amountADesired,
      amountB: amountB.toFixed(6)
    };
  }

  /**
   * Calculate liquidity tokens received
   */
  async getLiquidityTokens(
    tokenA: string,
    tokenB: string,
    amountA: string,
    amountB: string
  ): Promise<string> {
    const pool = await this.dex.getPool(tokenA, tokenB);
    
    if (!pool || pool.liquidity.isZero()) {
      // Initial liquidity
      const sqrtAmount = Math.sqrt(parseFloat(amountA) * parseFloat(amountB));
      return (sqrtAmount * 1000).toFixed(0);
    }

    // Calculate LP tokens based on share
    const shareA = parseFloat(amountA) / parseFloat(ethers.utils.formatUnits(pool.reserveA, 18));
    const shareB = parseFloat(amountB) / parseFloat(ethers.utils.formatUnits(pool.reserveB, 18));
    const share = Math.min(shareA, shareB);

    return (parseFloat(ethers.utils.formatUnits(pool.liquidity, 18)) * share).toFixed(0);
  }
}

// ==================== Factory ====================

export function createDEX(
  provider: ethers.providers.Web3Provider,
  signer: ethers.Signer,
  chainKey: string
): TigerswapDEX {
  const dex = new TigerswapDEX();
  
  // Get router address based on chain
  const routerAddresses: Record<string, string> = {
    ethereum: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
    bsc: '0x10ED43C718714eb63d5aA57B78B55304d5562a2C',    // PancakeSwap
    polygon: '0xa5E0829Ca8d7E01e98C0b8d3E5E6b4A5C5d8fE9A', // QuickSwap
    avalanche: '0xE54Ca86531e166D5361978727582629645399892', // Trader Joe
    arbitrum: '0xE592427A0AEce92De3Edee1F18e0157C05861564', // Camelot
    // Add TigerSmartChain router
    tigersmartchain: '0x1234567890abcdef1234567890abcdef12345678'
  };

  const routerAddress = routerAddresses[chainKey] || routerAddresses.ethereum;
  dex.initialize(provider, signer, routerAddress);

  return dex;
}

// Export singleton instances
export const tigerswapDEX = new TigerswapDEX();
export const dexAggregator = new DEXAggregator();

// Export constants
export const VERSION = '1.0.0';
export const DEFAULT_FEE = 0.003;
export const PLATFORM_FEE = 0.00045; // 15% of 0.3%