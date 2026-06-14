/**
 * TigerEx - Fee Collection System
 * 
 * Centralized fee collection from all TigerEx products:
 * - Exchange trading fees
 * - DEX swap fees
 * - Bridge cross-chain fees
 * - Wallet transaction fees
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

import { ethers, BigNumber } from 'ethers';

// ==================== Fee Types ====================

export enum FeeType {
  EXCHANGE = 'exchange',
  DEX = 'dex',
  BRIDGE = 'bridge',
  WALLET = 'wallet',
  STAKING = 'staking',
  PLATFORM = 'platform',
  WITHDRAWAL = 'withdrawal',
  DEPOSIT = 'deposit'
}

export interface Fee {
  type: FeeType;
  amount: BigNumber;
  token: string;
  chainKey: string;
  timestamp: number;
  txHash?: string;
  description?: string;
}

export interface FeeSummary {
  total: BigNumber;
  breakdown: Record<FeeType, BigNumber>;
  byChain: Record<string, BigNumber>;
}

export interface DailyFeeStats {
  date: string;
  total: BigNumber;
  fees: Record<FeeType, BigNumber>;
}

export interface FeeCollectorConfig {
  // Fee percentages
  exchangeFeePercent: number;
  dexSwapFeePercent: number;
  bridgeFeePercent: number;
  walletFeePercent: number;
  stakingFeePercent: number;
  
  // Platform share (percentage of fees)
  platformShare: number;
  
  // Minimum fees
  minExchangeFee: BigNumber;
  minDexFee: BigNumber;
  minBridgeFee: BigNumber;
  minWalletFee: BigNumber;
  
  // Fee collection enabled
  enabled: boolean;
}

// ==================== Fee Collector ====================

export class FeeCollector {
  private config: FeeCollectorConfig;
  private fees: Map<string, Fee[]> = new Map();
  private totalFees: Map<FeeType, BigNumber> = new Map();
  private chainFees: Map<string, Map<FeeType, BigNumber>> = new Map();
  private dailyFees: Map<string, Fee[]> = new Map();
  
  // Events
  private listeners: Map<string, Function[]> = new Map();

  /**
   * Create fee collector with configuration
   */
  constructor(config?: Partial<FeeCollectorConfig>) {
    this.config = {
      exchangeFeePercent: 0.001, // 0.1%
      dexSwapFeePercent: 0.003, // 0.3%
      bridgeFeePercent: 0.001, // 0.1%
      walletFeePercent: 0.0001, // 0.0001 TGR
      stakingFeePercent: 0.05, // 5%
      platformShare: 0.15, // 15%
      minExchangeFee: BigNumber.from('100000000000000000'), // 0.0001 TGR
      minDexFee: BigNumber.from('1000000000000000'), // 0.000001 TGR
      minBridgeFee: BigNumber.from('100000000000000'), // 0.0001 TGR
      minWalletFee: BigNumber.from('100000000000000'), // 0.0001 TGR
      enabled: true,
      ...config
    };

    // Initialize fee accumulators
    for (const type of Object.values(FeeType)) {
      this.totalFees.set(type, BigNumber.from(0));
    }
  }

  /**
   * Record a fee
   */
  recordFee(
    type: FeeType,
    amount: BigNumber,
    chainKey: string,
    token: string = 'TGR',
    txHash?: string,
    description?: string
  ): void {
    if (!this.config.enabled) return;

    const fee: Fee = {
      type,
      amount,
      token,
      chainKey,
      timestamp: Date.now(),
      txHash,
      description
    };

    // Add to fees list
    const key = `${type}-${chainKey}`;
    if (!this.fees.has(key)) {
      this.fees.set(key, []);
    }
    this.fees.get(key)!.push(fee);

    // Update totals
    const currentTotal = this.totalFees.get(type) || BigNumber.from(0);
    this.totalFees.set(type, currentTotal.add(amount));

    // Update chain fees
    if (!this.chainFees.has(chainKey)) {
      this.chainFees.set(chainKey, new Map());
    }
    const chainFeeTotal = this.chainFees.get(chainKey)!.get(type) || BigNumber.from(0);
    this.chainFees.get(chainKey)!.set(type, chainFeeTotal.add(amount));

    // Update daily fees
    const today = new Date().toISOString().split('T')[0];
    if (!this.dailyFees.has(today)) {
      this.dailyFees.set(today, []);
    }
    this.dailyFees.get(today)!.push(fee);

    // Emit event
    this.emit('feeRecorded', fee);
  }

  /**
   * Calculate exchange fee
   */
  calculateExchangeFee(tradeValue: BigNumber): BigNumber {
    const fee = tradeValue.mul(this.config.exchangeFeePercent).div(10000);
    return BigNumber.max(fee, this.config.minExchangeFee);
  }

  /**
   * Calculate DEX swap fee
   */
  calculateDexSwapFee(amountIn: BigNumber): BigNumber {
    const fee = amountIn.mul(this.config.dexSwapFeePercent).div(10000);
    return BigNumber.max(fee, this.config.minDexFee);
  }

  /**
   * Calculate bridge fee
   */
  calculateBridgeFee(amount: BigNumber): BigNumber {
    const percentageFee = amount.mul(this.config.bridgeFeePercent).div(10000);
    return BigNumber.max(percentageFee, this.config.minBridgeFee);
  }

  /**
   * Calculate wallet transaction fee
   */
  calculateWalletFee(gasLimit: BigNumber, gasPrice: BigNumber): BigNumber {
    const fee = gasLimit.mul(gasPrice);
    const adjustedFee = fee.add(
      BigNumber.from(this.config.minWalletFee)
    );
    return adjustedFee;
  }

  /**
   * Calculate staking fee
   */
  calculateStakingFee(rewards: BigNumber): BigNumber {
    return rewards.mul(this.config.stakingFeePercent).div(10000);
  }

  /**
   * Get platform fee share
   */
  getPlatformShare(feeType: FeeType, amount: BigNumber): BigNumber {
    const platformFee = amount.mul(this.config.platformShare).div(100);
    return platformFee;
  }

  /**
   * Get total fees by type
   */
  getTotalFees(type: FeeType): BigNumber {
    return this.totalFees.get(type) || BigNumber.from(0);
  }

  /**
   * Get total fees by chain
   */
  getChainFees(chainKey: string): Record<FeeType, BigNumber> {
    const chainFeeMap = this.chainFees.get(chainKey);
    if (!chainFeeMap) {
      return {} as Record<FeeType, BigNumber>;
    }

    const result: Record<FeeType, BigNumber> = {} as Record<FeeType, BigNumber>;
    for (const [type, amount] of chainFeeMap) {
      result[type] = amount;
    }
    return result;
  }

  /**
   * Get all-time fee summary
   */
  getFeeSummary(): FeeSummary {
    const breakdown: Record<FeeType, BigNumber> = {} as Record<FeeType, BigNumber>;
    const byChain: Record<string, BigNumber> = {};

    // Sum up all fees by type
    for (const [type, amount] of this.totalFees) {
      breakdown[type] = amount;
    }

    // Sum up all fees by chain
    for (const [chain, feeMap] of this.chainFees) {
      let chainTotal = BigNumber.from(0);
      for (const amount of feeMap.values()) {
        chainTotal = chainTotal.add(amount);
      }
      byChain[chain] = chainTotal;
    }

    // Calculate total
    let total = BigNumber.from(0);
    for (const amount of breakdown) {
      total = total.add(amount);
    }

    return { total, breakdown, byChain };
  }

  /**
   * Get daily fee stats
   */
  getDailyStats(days: number = 30): DailyFeeStats[] {
    const stats: DailyFeeStats[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayFees = this.dailyFees.get(dateStr) || [];
      const feeTotals: Record<FeeType, BigNumber> = {} as Record<FeeType, BigNumber>;
      let dayTotal = BigNumber.from(0);

      for (const fee of dayFees) {
        if (!feeTotals[fee.type]) {
          feeTotals[fee.type] = BigNumber.from(0);
        }
        feeTotals[fee.type] = feeTotals[fee.type].add(fee.amount);
        dayTotal = dayTotal.add(fee.amount);
      }

      stats.push({
        date: dateStr,
        total: dayTotal,
        fees: feeTotals
      });
    }

    return stats;
  }

  /**
   * Get revenue share (for distribution)
   */
  getRevenueShare(): {
    platform: BigNumber;
    team: BigNumber;
    rewards: BigNumber;
    treasury: BigNumber;
  } {
    const total = this.getFeeSummary().total;
    
    // Platform: 15%
    const platform = total.mul(15).div(100);
    
    // Team: 10%
    const team = total.mul(10).div(100);
    
    // Rewards: 25%
    const rewards = total.mul(25).div(100);
    
    // Treasury: 50%
    const treasury = total.mul(50).div(100);

    return { platform, team, rewards, treasury };
  }

  /**
   * Withdraw fees (admin function)
   */
  async withdraw(
    recipient: string,
    amount: BigNumber,
    token: string = 'TGR'
  ): Promise<string> {
    // In production, call fee withdrawal contract
    return `0x${'a'.repeat(64)}`;
  }

  /**
   * Get configuration
   */
  getConfig(): FeeCollectorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FeeCollectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Enable/disable fee collection
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
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

  /**
   * Export fees for reporting
   */
  exportFees(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      // CSV export
      const headers = 'Date,Type,Chain,Token,Amount,TxHash,Description';
      const rows = [headers];

      for (const [, feeList] of this.fees) {
        for (const fee of feeList) {
          rows.push(
            `${new Date(fee.timestamp).toISOString()},${fee.type},${fee.chainKey},${fee.token},${fee.amount},${fee.txHash || ''},${fee.description || ''}`
          );
        }
      }

      return rows.join('\n');
    }

    // JSON export
    return JSON.stringify({
      summary: this.getFeeSummary(),
      daily: this.getDailyStats(),
      config: this.config
    }, null, 2);
  }
}

// ==================== Fee Distributor ====================

export class FeeDistributor {
  private collector: FeeCollector;
  private recipients: Map<string, BigNumber> = new Map();

  /**
   * Create fee distributor
   */
  constructor(collector: FeeCollector) {
    this.collector = collector;
  }

  /**
   * Add recipient for fee distribution
   */
  addRecipient(address: string, sharePercent: number): void {
    this.recipients.set(address, BigNumber.from(sharePercent));
  }

  /**
   * Distribute fees to recipients
   */
  async distribute(): Promise<string[]> {
    const shares = this.collector.getRevenueShare();
    const txHashes: string[] = [];

    for (const [address, share] of this.recipients) {
      const amount = shares.platform.mul(share.toNumber()).div(100);
      
      // In production, transfer tokens
      txHashes.push(`0x${'b'.repeat(64)}`);
    }

    return txHashes;
  }

  /**
   * Get pending distributions
   */
  getPendingDistributions(): {
    address: string;
    amount: BigNumber;
    share: number;
  }[] {
    const shares = this.collector.getRevenueShare();
    const pending: {
      address: string;
      amount: BigNumber;
      share: number;
    }[] = [];

    for (const [address, share] of this.recipients) {
      const amount = shares.platform.mul(share.toNumber()).div(100);
      pending.push({
        address,
        amount,
        share: share.toNumber()
      });
    }

    return pending;
  }
}

// ==================== Factory ====================

export function createFeeCollector(
  config?: Partial<FeeCollectorConfig>
): FeeCollector {
  return new FeeCollector(config);
}

// Export singleton instance
export const feeCollector = new FeeCollector();

// Export constants
export const VERSION = '1.0.0';
export const DEFAULT_FEES = {
  exchange: 0.001,
  dex: 0.003,
  bridge: 0.001,
  wallet: 0.0001,
  staking: 0.05
};