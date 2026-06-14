/**
 * TigerEx - TigerSmartChain Integration
 * 
 * TigerSmartChain (EVM Blockchain) Integration
 * Features: TGR Token, RUSD Stablecoin, Cross-chain Bridges, Staking
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

import { ethers, BigNumber, Contract, providers, Wallet, Interface } from 'ethers';
import { ERC20_ABI, BRIDGE_ABI, STAKING_ABI } from './abis';
import { TOKENS, SUPPORTED_CHAINS, ChainConfig } from './wallet';

// ==================== TigerSmartChain Configuration ====================

export interface TGRConfig {
  // Token configuration
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: BigNumber;
  priceUSD: number;
  
  // Tokenomics
  maxSupply: BigNumber;
  initialSupply: BigNumber;
  teamAllocation: BigNumber;
  communityAllocation: BigNumber;
  stakingAllocation: BigNumber;
  
  // Features
  autoStake: boolean;
  deflationary: boolean;
  rebaseEnabled: boolean;
}

export interface RUSDConfig {
  // Stablecoin configuration
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: BigNumber;
  targetPeg: number; // 1.0 USD
  
  // Stability mechanisms
  collateralRatio: number;
  mintingFee: number;
  redemptionFee: number;
  liquidationThreshold: number;
  
  // Oracles
  oracleAddress: string;
  chainlinkFeed: string;
}

export interface BridgeConfig {
  id: string;
  sourceChain: string;
  targetChain: string;
  minAmount: BigNumber;
  maxAmount: BigNumber;
  fee: BigNumber;
  feePercent: number;
  timeEstimate: number;
  isActive: boolean;
}

export interface ValidatorConfig {
  address: string;
  stakeAmount: BigNumber;
  commission: number;
  delegators: number;
  totalStaked: BigNumber;
  rewards: BigNumber;
  isActive: boolean;
}

// ==================== TigerSmartChain Class ====================

export class TigerSmartChain {
  private provider: providers.Web3Provider | null = null;
  private signer: Wallet | null = null;
  private account: string = '';
  
  // Contract addresses
  private tgrAddress: string = '';
  private rusdAddress: string = '';
  private bridgeAddress: string = '';
  private stakingAddress: string = '';
  
  // Native token configuration
  private tgrConfig: TGRConfig = {
    address: '',
    name: 'Tiger Coin',
    symbol: 'TGR',
    decimals: 18,
    totalSupply: BigNumber.from(0),
    priceUSD: 0.05,
    maxSupply: BigNumber.from('1000000000000000000000000000000'), // 1B TGR
    initialSupply: BigNumber.from('100000000000000000000000000000'), // 100M initial
    teamAllocation: BigNumber.from('20000000000000000000000000000'), // 20M team
    communityAllocation: BigNumber.from('50000000000000000000000000000'), // 50M community
    stakingAllocation: BigNumber.from('30000000000000000000000000000'), // 30M staking
    autoStake: true,
    deflationary: true,
    rebaseEnabled: false
  };

  private rusdConfig: RUSDConfig = {
    address: '',
    name: 'Royal Tiger United States Dollar',
    symbol: 'RUSD',
    decimals: 18,
    totalSupply: BigNumber.from(0),
    targetPeg: 1.0,
    collateralRatio: 1.1, // 110% overcollateralized
    mintingFee: 0.001, // 0.1%
    redemptionFee: 0.001, // 0.1%
    liquidationThreshold: 0.8, // 80% threshold
    oracleAddress: '',
    chainlinkFeed: '0x0000000000000000000000000000000000000000' // Replace with actual
  };

  private bridges: Map<string, BridgeConfig> = new Map();
  private validators: Map<string, ValidatorConfig> = new Map();

  /**
   * Initialize TigerSmartChain with provider
   */
  async initialize(rpcUrl: string, contracts?: {
    tgr?: string;
    rusd?: string;
    bridge?: string;
    staking?: string;
  }): Promise<void> {
    this.provider = new providers.JsonRpcProvider(rpcUrl);
    
    // Set default contract addresses
    this.tgrAddress = contracts?.tgr || '0x0000000000000000000000000000000000000000';
    this.rusdAddress = contracts?.rusd || '0x7886Cc6E7C5E8c4B7d9338d4B2dA6aF7dC3f8F8C8';
    this.bridgeAddress = contracts?.bridge || '0x1111111111111111111111111111111111111111';
    this.stakingAddress = contracts?.staking || '0x2222222222222222222222222222222222222222';

    this.tgrConfig.address = this.tgrAddress;
    this.rusdConfig.address = this.rusdAddress;

    // Initialize default bridges
    this.initializeBridges();
  }

  /**
   * Set signer/wallet
   */
  setSigner(signer: Wallet, account: string): void {
    this.signer = signer;
    this.account = account;
  }

  /**
   * Get TGR configuration
   */
  getTGRConfig(): TGRConfig {
    return { ...this.tgrConfig };
  }

  /**
   * Get RUSD configuration
   */
  getRUSDConfig(): RUSDConfig {
    return { ...this.rusdConfig };
  }

  /**
   * Get TGR balance
   */
  async getTGRBalance(address: string): Promise<BigNumber> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    return await this.provider.getBalance(address);
  }

  /**
   * Get RUSD balance
   */
  async getRUDBalance(address: string): Promise<BigNumber> {
    if (!this.provider || !this.rusdAddress) {
      throw new Error('Provider not initialized');
    }

    const rusd = new Contract(this.rusdAddress, ERC20_ABI, this.provider);
    return await rusd.balanceOf(address);
  }

  /**
   * Transfer TGR (native token)
   */
  async transferTGR(to: string, amount: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not initialized');
    }

    const tx = await this.signer.sendTransaction({
      to,
      value: ethers.utils.parseEther(amount)
    });

    return tx.hash;
  }

  /**
   * Transfer RUSD (stablecoin)
   */
  async transferRUSD(to: string, amount: string): Promise<string> {
    if (!this.signer || !this.rusdAddress) {
      throw new Error('Signer not initialized');
    }

    const rusd = new Contract(this.rusdAddress, ERC20_ABI, this.signer);
    const tx = await rusd.transfer(to, ethers.utils.parseEther(amount));

    return tx.hash;
  }

  /**
   * Mint RUSD (requires collateral)
   */
  async mintRUSD(amount: string, collateral: string): Promise<string> {
    if (!this.signer || !this.rusdAddress) {
      throw new Error('Signer not initialized');
    }

    // Check collateral ratio
    const collateralBN = BigNumber.from(collateral);
    const amountBN = ethers.utils.parseEther(amount);
    const requiredCollateral = amountBN.mul(110).div(100); // 110% collateral

    if (collateralBN.lt(requiredCollateral)) {
      throw new Error('Insufficient collateral');
    }

    // Mint RUSD
    const rusd = new Contract(this.rusdAddress, ERC20_ABI, this.signer);
    const tx = await rusd.mint(this.account, amountBN, {
      value: requiredCollateral
    });

    return tx.hash;
  }

  /**
   * Burn RUSD (redeem for collateral)
   */
  async burnRUSD(amount: string): Promise<string> {
    if (!this.signer || !this.rusdAddress) {
      throw new Error('Signer not initialized');
    }

    const rusd = new Contract(this.rusdAddress, ERC20_ABI, this.signer);
    const tx = await rusd.burn(amount);

    return tx.hash;
  }

  // ==================== Bridge Operations ====================

  /**
   * Get bridge configuration
   */
  getBridge(sourceChain: string, targetChain: string): BridgeConfig | null {
    const key = `${sourceChain}-${targetChain}`;
    return this.bridges.get(key) || null;
  }

  /**
   * Initiate bridge transfer
   */
  async bridge(
    targetChain: string,
    token: string,
    amount: string
  ): Promise<{ txHash: string; bridgeId: string }> {
    if (!this.signer) {
      throw new Error('Signer not initialized');
    }

    const bridge = this.bridges.get(`tigersmartchain-${targetChain}`);
    if (!bridge || !bridge.isActive) {
      throw new Error(`Bridge not available: ${targetChain}`);
    }

    const amountBN = BigNumber.from(amount);
    
    // Check min/max limits
    if (amountBN.lt(bridge.minAmount)) {
      throw new Error(`Amount below minimum: ${bridge.minAmount}`);
    }
    if (amountBN.gt(bridge.maxAmount)) {
      throw new Error(`Amount above maximum: ${bridge.maxAmount}`);
    }

    // Calculate bridge fee
    const feeAmount = amountBN.mul(bridge.feePercent).div(10000);
    const totalAmount = amountBN.add(feeAmount);

    // Approve token if not native
    if (token !== 'TGR') {
      const tokenContract = new Contract(TOKENS[token]?.address || token, ERC20_ABI, this.signer);
      await tokenContract.approve(this.bridgeAddress, totalAmount);
    }

    // Call bridge contract
    const bridgeContract = new Contract(
      this.bridgeAddress,
      BRIDGE_ABI,
      this.signer
    );

    const tx = await bridgeContract.deposit(
      targetChain,
      token,
      totalAmount,
      this.account
    );

    // Record bridge fee
    console.log(`Bridge fee: ${feeAmount} to ${targetChain}`);

    return {
      txHash: tx.hash,
      bridgeId: bridge.id
    };
  }

  /**
   * Complete bridge withdrawal
   */
  async completeWithdrawal(
    recipient: string,
    token: string,
    amount: string,
    proof: string
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not initialized');
    }

    const bridgeContract = new Contract(
      this.bridgeAddress,
      BRIDGE_ABI,
      this.signer
    );

    const tx = await bridgeContract.withdraw(
      recipient,
      token,
      amount,
      proof
    );

    return tx.hash;
  }

  // ==================== Staking Operations ====================

  /**
   * Stake TGR
   */
  async stakeTGR(amount: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not initialized');
    }

    const amountBN = ethers.utils.parseEther(amount);
    
    // Approve TGR for staking
    if (this.tgrAddress !== ethers.constants.AddressZero) {
      const tgr = new Contract(this.tgrAddress, ERC20_ABI, this.signer);
      await tgr.approve(this.stakingAddress, amountBN);
    }

    // Stake
    const staking = new Contract(
      this.stakingAddress,
      STAKING_ABI,
      this.signer
    );

    const tx = await staking.stake(amountBN);
    return tx.hash;
  }

  /**
   * Unstake TGR
   */
  async unstakeTGR(amount: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not initialized');
    }

    const staking = new Contract(
      this.stakingAddress,
      STAKING_ABI,
      this.signer
    );

    const tx = await staking.unstake(ethers.utils.parseEther(amount));
    return tx.hash;
  }

  /**
   * Claim staking rewards
   */
  async claimRewards(): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not initialized');
    }

    const staking = new Contract(
      this.stakingAddress,
      STAKING_ABI,
      this.signer
    );

    const tx = await staking.claimReward();
    return tx.hash;
  }

  /**
   * Get staking info
   */
  async getStakingInfo(address: string): Promise<{
    staked: BigNumber;
    rewards: BigNumber;
    apr: number;
    unlockTime: number;
  }> {
    if (!this.provider || !this.stakingAddress) {
      throw new Error('Provider not initialized');
    }

    const staking = new Contract(this.stakingAddress, STAKING_ABI, this.provider);
    
    const [staked, rewards, apr, unlockTime] = await Promise.all([
      staking.stakedBalance(address),
      staking.pendingReward(address),
      staking.apr(),
      staking.unlockTime(address)
    ]);

    return {
      staked,
      rewards,
      apr: apr.toNumber(),
      unlockTime: unlockTime.toNumber()
    };
  }

  // ==================== Price Oracle ====================

  /**
   * Get TGR price
   */
  async getTGRPrice(): Promise<number> {
    // In production, fetch from oracle
    return this.tgrConfig.priceUSD;
  }

  /**
   * Get RUSD price
   */
  async getRUSDPrice(): Promise<number> {
    // In production, fetch from oracle
    return this.rusdConfig.targetPeg;
  }

  /**
   * Update prices from oracle
   */
  async updatePrices(): Promise<void> {
    // In production, fetch from Chainlink or other oracle
    console.log('Prices updated from oracle');
  }

  // ==================== Utility Methods ====================

  /**
   * Get chain ID
   */
  getChainId(): number {
    return 2024; // TigerSmartChain chain ID
  }

  /**
   * Get native symbol
   */
  getNativeSymbol(): string {
    return 'TGR';
  }

  /**
   * Get stablecoin symbol
   */
  getStablecoinSymbol(): string {
    return 'RUSD';
  }

  /**
   * Get all bridges
   */
  getAllBridges(): BridgeConfig[] {
    return Array.from(this.bridges.values());
  }

  /**
   * Get all validators
   */
  getAllValidators(): ValidatorConfig[] {
    return Array.from(this.validators.values());
  }

  // Private methods

  private initializeBridges(): void {
    const defaultBridges: BridgeConfig[] = [
      {
        id: 'bridge-tgr-eth',
        sourceChain: 'tigersmartchain',
        targetChain: 'ethereum',
        minAmount: BigNumber.from('100000000000000000'), // 0.1 TGR
        maxAmount: BigNumber.from('100000000000000000000000'), // 100k TGR
        fee: BigNumber.from('100000000000000000'), // 0.0001 TGR
        feePercent: 10, // 0.1%
        timeEstimate: 300, // 5 minutes
        isActive: true
      },
      {
        id: 'bridge-tgr-bsc',
        sourceChain: 'tigersmartchain',
        targetChain: 'bsc',
        minAmount: BigNumber.from('100000000000000000'),
        maxAmount: BigNumber.from('100000000000000000000000'),
        fee: BigNumber.from('100000000000000000'),
        feePercent: 10,
        timeEstimate: 300,
        isActive: true
      },
      {
        id: 'bridge-tgr-polygon',
        sourceChain: 'tigersmartchain',
        targetChain: 'polygon',
        minAmount: BigNumber.from('100000000000000000'),
        maxAmount: BigNumber.from('100000000000000000000000'),
        fee: BigNumber.from('100000000000000000'),
        feePercent: 10,
        timeEstimate: 300,
        isActive: true
      },
      {
        id: 'bridge-tgr-avalanche',
        sourceChain: 'tigersmartchain',
        targetChain: 'avalanche',
        minAmount: BigNumber.from('100000000000000000'),
        maxAmount: BigNumber.from('100000000000000000000000'),
        fee: BigNumber.from('100000000000000000'),
        feePercent: 10,
        timeEstimate: 300,
        isActive: true
      },
      {
        id: 'bridge-tgr-arbitrum',
        sourceChain: 'tigersmartchain',
        targetChain: 'arbitrum',
        minAmount: BigNumber.from('100000000000000000'),
        maxAmount: BigNumber.from('100000000000000000000000'),
        fee: BigNumber.from('100000000000000000'),
        feePercent: 10,
        timeEstimate: 600,
        isActive: true
      },
      {
        id: 'bridge-tgr-optimism',
        sourceChain: 'tigersmartchain',
        targetChain: 'optimism',
        minAmount: BigNumber.from('100000000000000000'),
        maxAmount: BigNumber.from('100000000000000000000000'),
        fee: BigNumber.from('100000000000000000'),
        feePercent: 10,
        timeEstimate: 600,
        isActive: true
      },
      {
        id: 'bridge-tgr-base',
        sourceChain: 'tigersmartchain',
        targetChain: 'base',
        minAmount: BigNumber.from('100000000000000000'),
        maxAmount: BigNumber.from('100000000000000000000000'),
        fee: BigNumber.from('100000000000000000'),
        feePercent: 10,
        timeEstimate: 300,
        isActive: true
      },
      {
        id: 'bridge-tgr-solana',
        sourceChain: 'tigersmartchain',
        targetChain: 'solana',
        minAmount: BigNumber.from('100000000000000000'),
        maxAmount: BigNumber.from('100000000000000000000000000'),
        fee: BigNumber.from('200000000000000000'), // 0.0002 TGR
        feePercent: 15,
        timeEstimate: 900,
        isActive: true
      }
    ];

    for (const bridge of defaultBridges) {
      const key = `${bridge.sourceChain}-${bridge.targetChain}`;
      this.bridges.set(key, bridge);
    }
  }
}

// ==================== TigerScan Explorer ====================

export class TigerScan {
  private provider: providers.JsonRpcProvider | null = null;

  /**
   * Initialize explorer API
   */
  initialize(rpcUrl: string): void {
    this.provider = new providers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Get block by number
   */
  async getBlock(blockNumber: number): Promise<any> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    return await this.provider.getBlock(blockNumber);
  }

  /**
   * Get transaction
   */
  async getTransaction(txHash: string): Promise<any> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    return await this.provider.getTransaction(txHash);
  }

  /**
   * Get transaction receipt
   */
  async getReceipt(txHash: string): Promise<any> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    return await this.provider.getTransactionReceipt(txHash);
  }

  /**
   * Get address balance
   */
  async getBalance(address: string): Promise<BigNumber> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    return await this.provider.getBalance(address);
  }

  /**
   * Get token balance
   */
  async getTokenBalance(address: string, token: string): Promise<BigNumber> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    const tokenContract = new Contract(token, ERC20_ABI, this.provider);
    return await tokenContract.balanceOf(address);
  }

  /**
   * Get token transfers
   */
  async getTransfers(address: string, limit: number = 50): Promise<any[]> {
    // In production, query indexer or logs
    return [];
  }

  /**
   * Get account transactions
   */
  async getAccountTransactions(
    address: string,
    limit: number = 50
  ): Promise<any[]> {
    // In production, query indexer
    return [];
  }
}

// ==================== Factory ====================

export function createTigerSmartChain(
  rpcUrl: string = 'https://rpc.tigersmartchain.com',
  contracts?: {
    tgr?: string;
    rusd?: string;
    bridge?: string;
    staking?: string;
  }
): Promise<TigerSmartChain> {
  const tsc = new TigerSmartChain();
  return tsc.initialize(rpcUrl, contracts).then(() => tsc);
}

export function createTigerScan(
  rpcUrl: string = 'https://rpc.tigersmartchain.com'
): TigerScan {
  const explorer = new TigerScan();
  explorer.initialize(rpcUrl);
  return explorer;
}

// Export singleton instances
export const tigerSmartChain = new TigerSmartChain();
export const tigerScan = new TigerScan();

// Export constants
export const CHAIN_ID = 2024;
export const NATIVE_SYMBOL = 'TGR';
export const STABLECOIN_SYMBOL = 'RUSD';
export const VERSION = '1.0.0';