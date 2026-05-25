/**
 * Referral & Rewards System
 * Multi-tier referral program with rewards
 */

import { EventEmitter } from 'events';

// ============================================================================
// REFERRAL TIERS
// ============================================================================

export interface ReferralTier {
  level: number;
  name: string;
  referralRewardPercent: number;  // % of fees paid to referrer
  rewardSoulboundToken: boolean;
  requiredReferrals: number;
  requiredVolume: number;
  badge: string;
}

export interface Referral {
  id: string;
  referrerId: string;      // Who refers
  refereeId: string;    // Being referred
  referrerCode: string;   // Referrer's code
  refereeCode: string;    // Referee's code
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  registeredAt: number;
  completedAt?: number;
  rewardPaid: number;
}

export interface RewardRecord {
  id: string;
  userId: string;
  type: 'referral' | 'trade' | 'deposit' | 'volume' | 'badge';
  amount: number;
  currency: string;
  timestamp: number;
  lockedUntil?: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  totalReferrals: number;
  totalVolume: number;
  totalRewards: number;
}

// ============================================================================
// REFERRAL MANAGER
// ============================================================================

export class ReferralManager extends EventEmitter {
  private referrals: Map<string, Referral> = new Map();
  private userReferralCodes: Map<string, string> = new Map();
  private rewards: Map<string, RewardRecord[]> = new Map();
  private tiers: ReferralTier[];

  constructor() {
    super();
    this.tiers = this.initTiers();
  }

  // ============================================================================
  // INIT REFERRAL TIERS
  // ============================================================================

  private initTiers(): ReferralTier[] {
    return [
      { level: 0, name: 'Bronze', referralRewardPercent: 5, rewardSoulboundToken: false, requiredReferrals: 0, requiredVolume: 0, badge: '🥉' },
      { level: 1, name: 'Silver', referralRewardPercent: 10, rewardSoulboundToken: false, requiredReferrals: 5, requiredVolume: 10000, badge: '🥈' },
      { level: 2, name: 'Gold', referralRewardPercent: 15, rewardSoulboundToken: true, requiredReferrals: 20, requiredVolume: 100000, badge: '🥇' },
      { level: 3, name: 'Platinum', referralRewardPercent: 20, rewardSoulboundToken: true, requiredReferrals: 50, requiredVolume: 1000000, badge: '💎' },
      { level: 4, name: 'Diamond', referralRewardPercent: 30, rewardSoulboundToken: true, requiredReferrals: 100, requiredVolume: 10000000, badge: '💠' },
    ];
  }

  // ============================================================================
  // GENERATE UNIQUE REFERRAL CODE
  // ============================================================================

  generateReferralCode(userId: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    
    // First 4 chars: user identifier
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Last 4 chars: random
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    this.userReferralCodes.set(code, userId);
    return code;
  }

  // ============================================================================
  // CREATE REFERRAL LINK
  // ============================================================================

  async createReferral(referrerId: string): Promise<{ referralCode: string; referralLink: string }> {
    // Check if user already has code
    let existingCode: string | undefined;
    
    for (const [code, uid] of this.userReferralCodes) {
      if (uid === referrerId) {
        existingCode = code;
        break;
      }
    }
    
    const referralCode = existingCode || this.generateReferralCode(referrerId);
    const referralLink = `https://tigerex.com/ref/${referralCode}`;
    
    return { referralCode, referralLink };
  }

  // ============================================================================
  // APPLY REFERRAL (Sign up with code)
  // ============================================================================

  async applyReferral(referrerId: string, refereeId: string, referralCode: string): Promise<{
    success: boolean;
    refereeReward: number;
    referrerReward: number;
  }> {
    const referrerUid = this.userReferralCodes.get(referralCode);
    if (!referrerUid || referrerUid === refereeId) {
      return { success: false, refereeReward: 0, referrerReward: 0 };
    }
    
    // Create referral record
    const referral: Referral = {
      id: `ref_${Date.now()}`,
      referrerId: referrerUid,
      refereeId,
      referrerCode: referralCode,
      refereeCode: this.generateReferralCode(refereeId),
      status: 'pending',
      registeredAt: Date.now(),
      rewardPaid: 0,
    };
    
    this.referrals.set(referral.id, referral);
    
    // Give referee sign-up bonus ($10 credit)
    const refereeBonus = 10;
    this.addReward(refereeId, 'referral', refereeBonus, 'USDT');
    
    return { success: true, refereeReward: refereeBonus, referrerReward: 0 };
  }

  // ============================================================================
  // PROCESS TRADE REWARD
  // ============================================================================

  async processTradeReward(referrerId: string, refereeId: string, feeAmount: number): Promise<number> {
    const referral = Array.from(this.referrals.values())
      .find(r => r.referrerId === referrerId && r.refereeId === refereeId && r.status === 'active');
    
    if (!referral) return 0;
    
    const refereeTier = this.getRefereeTier(refereeId);
    const rewardPercent = refereeTier.referralRewardPercent / 100;
    const reward = feeAmount * rewardPercent;
    
    this.addReward(referrerId, 'trade', reward, 'USDT');
    referral.rewardPaid += reward;
    
    // Mark as completed if first trade
    if (referral.status === 'pending') {
      referral.status = 'active';
      referral.completedAt = Date.now();
    }
    
    return reward;
  }

  // ============================================================================
  // GET REFERRAL TIER
  // ============================================================================

  getRefereeTier(userId: string): ReferralTier {
    const refs = this.getReferrals(userId, 'referrer');
    let totalVolume = 0;
    
    for (const ref of refs) {
      if (ref.status === 'active') {
        totalVolume += ref.rewardPaid * 100; // Approximate volume from rewards
      }
    }
    
    const numRefs = refs.length;
    
    for (let i = this.tiers.length - 1; i >= 0; i--) {
      if (numRefs >= this.tiers[i].requiredReferrals || 
          totalVolume >= this.tiers[i].requiredVolume) {
        return this.tiers[i];
      }
    }
    
    return this.tiers[0];
  }

  // ============================================================================
  // ADD REWARD
  // ============================================================================

  addReward(userId: string, type: RewardRecord['type'], amount: number, currency: string): void {
    const record: RewardRecord = {
      id: `rew_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      userId,
      type,
      amount,
      currency,
      timestamp: Date.now(),
    };
    
    const existing = this.rewards.get(userId) || [];
    existing.push(record);
    this.rewards.set(userId, existing);
    
    this.emit('rewardAdded', record);
  }

  // ============================================================================
  // GET REWARDS
  // ============================================================================

  getRewards(userId: string): RewardRecord[] {
    return this.rewards.get(userId) || [];
  }

  getTotalReward(userId: string): number {
    return this.getRewards(userId).reduce((sum, r) => sum + r.amount, 0);
  }

  // ============================================================================
  // GET REFERRALS
  // ============================================================================

  getReferrals(userId: string, role: 'referrer' | 'referee'): Referral[] {
    if (role === 'referrer') {
      return Array.from(this.referrals.values()).filter(r => r.referrerId === userId);
    } else {
      return Array.from(this.referrals.values()).filter(r => r.refereeId === userId);
    }
  }

  // ============================================================================
  // GET LEADERBOARD
  // ============================================================================

  async getLeaderboard(limit: number = 100): Promise<LeaderboardEntry[]> {
    const stats: Map<string, { referrals: number; volume: number; rewards: number }> = new Map();
    
    for (const ref of this.referrals.values()) {
      // Stats for referrer
      const current = stats.get(ref.referrerId) || { referrals: 0, volume: 0, rewards: 0 };
      current.referrals++;
      current.volume += ref.rewardPaid;
      stats.set(ref.referrerId, current);
    }
    
    const entries: LeaderboardEntry[] = [];
    
    let rank = 1;
    for (const [userId, data] of stats) {
      entries.push({
        rank: rank++,
        userId,
        totalReferrals: data.referrals,
        totalVolume: data.volume,
        totalRewards: data.rewards,
      });
    }
    
    return entries
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, limit);
  }

  // ============================================================================
  // GET STATS
  // ============================================================================

  async getAffiliateStats(userId: string): Promise<{
    totalReferrals: number;
    activeReferrals: number;
    totalVolume: number;
    totalEarned: number;
    currentTier: ReferralTier;
  }> {
    const refs = this.getReferrals(userId, 'referrer');
    const active = refs.filter(r => r.status === 'active');
    const totalVolume = refs.reduce((sum, r) => sum + r.rewardPaid, 0);
    const totalEarned = this.getTotalReward(userId);
    
    return {
      totalReferrals: refs.length,
      activeReferrals: active.length,
      totalVolume,
      totalEarned,
      currentTier: this.getRefereeTier(userId),
    };
  }
}

export default ReferralManager;