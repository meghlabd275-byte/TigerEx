/**
 * TigerEx Loyalty & Rewards Platform
 * 
 * Tiered rewards like TigerEx, Crypto.com
 * Features: Points, tiers, benefits, merchandise
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';

export enum TierLevel { BRONZE = 'bronze', SILVER = 'silver', GOLD = 'gold', PLATINUM = 'platinum', DIAMOND = 'diamond' }

export interface Reward { id: string; name: string; points: number; category: string; image?: string; stock?: number }

export interface UserRewards {
  user_id: string;
  points: number;
  lifetime_points: number;
  tier: TierLevel;
  benefits: string[];
  transactions: { points: number; description: string; date: Date }[];
}

export class LoyaltyPlatform {
  private logger: Logger;
  private rewards: Map<string, Reward> = new Map();
  private userRewards: Map<string, UserRewards> = new Map();
  private eventEmitter: EventEmitter;

  private readonly TIER_THRESHOLDS: Record<TierLevel, number> = { [TierLevel.BRONZE]: 0, [TierLevel.SILVER]: 10000, [TierLevel.GOLD]: 50000, [TierLevel.PLATINUM]: 200000, [TierLevel.DIAMOND]: 1000000 };
  private readonly TIER_BENEFITS: Record<TierLevel, string[]> = { [TierLevel.BRONZE]: ['Basic support'], [TierLevel.SILVER]: ['Priority support', '5% fee discount'], [TierLevel.GOLD]: ['Faster withdrawals', '10% fee discount'], [TierLevel.PLATINUM]: ['Dedicated manager', '20% fee discount'], [TierLevel.DIAMOND]: ['VIP events', '50% fee discount'] };

  constructor() {
    this.logger = new Logger('Loyalty');
    this.eventEmitter = new EventEmitter();
    this.initializeRewards();
  }

  private initializeRewards(): void {
    const defaultRewards: Reward[] = [
      { id: 'r1', name: '$10 USDT', points: 1000, category: 'Cash' },
      { id: 'r2', name: '$50 USDT', points: 4500, category: 'Cash' },
      { id: 'r3', name: 'T-Shirt', points: 5000, category: 'Merchandise', stock: 100 },
      { id: 'r4', name: 'Mug', points: 2000, category: 'Merchandise', stock: 200 },
      { id: 'r5', name: '1 Month VIP', points: 10000, category: 'Subscription' }
    ];
    defaultRewards.forEach(r => this.rewards.set(r.id, r));
  }

  async getPoints(userId: string): Promise<number> {
    const ur = this.userRewards.get(userId);
    return ur?.points || 0;
  }

  async getUserRewards(userId: string): Promise<UserRewards> {
    if (!this.userRewards.has(userId)) {
      const ur: UserRewards = { user_id: userId, points: 0, lifetime_points: 0, tier: TierLevel.BRONZE, benefits: this.TIER_BENEFITS[TierLevel.BRONZE], transactions: [] };
      this.userRewards.set(userId, ur);
    }
    return this.userRewards.get(userId)!;
  }

  async earnPoints(userId: string, points: number, description: string): Promise<void> {
    let ur = await this.getUserRewards(userId);
    ur.points += points;
    ur.lifetime_points += points;
    ur.transactions.unshift({ points, description, date: new Date() });
    const newTier = this.calculateTier(ur.lifetime_points);
    if (newTier !== ur.tier) { ur.tier = newTier; ur.benefits = this.TIER_BENEFITS[newTier]; }
    this.userRewards.set(userId, ur);
    this.eventEmitter.emit('points_earned', { userId, points });
  }

  async redeem(userId: string, itemId: string): Promise<{ success: boolean; message: string }> {
    const reward = this.rewards.get(itemId);
    if (!reward) throw new Error('Reward not found');
    const ur = await this.getUserRewards(userId);
    if (ur.points < reward.points) throw new Error('Insufficient points');
    ur.points -= reward.points;
    this.userRewards.set(userId, ur);
    this.eventEmitter.emit('reward_redeemed', { userId, reward });
    return { success: true, message: `Redeemed: ${reward.name}` };
  }

  async getRewards(): Promise<Reward[]> { return Array.from(this.rewards.values()); }
  async getTierInfo(tier: TierLevel): Promise<{ threshold: number; benefits: string[] }> { return { threshold: this.TIER_THRESHOLDS[tier], benefits: this.TIER_BENEFITS[tier] }; }

  private calculateTier(lifetime: number): TierLevel {
    if (lifetime >= this.TIER_THRESHOLDS[TierLevel.DIAMOND]) return TierLevel.DIAMOND;
    if (lifetime >= this.TIER_THRESHOLDS[TierLevel.PLATINUM]) return TierLevel.PLATINUM;
    if (lifetime >= this.TIER_THRESHOLDS[TierLevel.GOLD]) return TierLevel.GOLD;
    if (lifetime >= this.TIER_THRESHOLDS[TierLevel.SILVER]) return TierLevel.SILVER;
    return TierLevel.BRONZE;
  }
}

export default LoyaltyPlatform;