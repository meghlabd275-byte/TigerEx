/**
 * Social Trading & Media Platform
 * 
 * Creator economy, social trading, livestreaming, influencer rewards.
 */

export enum ContentType {
  TRADING_SIGNAL = 'trading_signal',
  STRATEGY_POST = 'strategy_post',
  LIVESTREAM = 'livestream',
  EDUCATIONAL = 'educational',
  MARKET_NEWS = 'market_news'
}

export class SocialTradingPlatform {
  private creators: Map<string, Creator> = new Map();
  private posts: SocialPost[] = [];
  private signals: TradingSignal[] = [];
  private followers: Map<string, string[]> = new Map();  // userId -> creatorIds

  /**
   * Apply to become a creator
   */
  async applyForCreator(input: CreatorApplication): Promise<Creator> {
    const creator: Creator = {
      id: `CREATOR-${Date.now()}`,
      userId: input.userId,
      displayName: input.displayName,
      bio: input.bio,
      specialties: input.specialties,
      status: 'pending',
      followerCount: 0,
      verifiedPositions: 0,
      totalPnl: 0,
      appliedAt: new Date()
    };

    this.creators.set(creator.id, creator);
    return creator;
  }

  /**
   * Approve creator
   */
  async approveCreator(creatorId: string, verifiedBy: string): Promise<void> {
    const creator = this.creators.get(creatorId);
    if (!creator) throw new Error('Creator not found');

    creator.status = 'approved';
    creator.approvedAt = new Date();
    creator.approvedBy = verifiedBy;
  }

  /**
   * Publish trading signal
   */
  async publishSignal(input: SignalInput): Promise<string> {
    const signal: TradingSignal = {
      id: `SIGNAL-${Date.now()}`,
      creatorId: input.creatorId,
      type: 'entry',
      symbol: input.symbol,
      direction: input.direction,
      entryPrice: input.entryPrice,
      targetPrices: input.targetPrices,
      stopLoss: input.stopLoss,
      positionSize: input.positionSize,
      confidence: input.confidence,
      reasoning: input.reasoning,
      postedAt: new Date(),
      expiresAt: new Date(Date.now() + (input.validForHours || 24) * 60 * 60 * 1000)
    };

    this.signals.push(signal);
    
    // Update creator stats
    const creator = this.creators.get(input.creatorId);
    if (creator) {
      creator.totalSignalsPosted++;
    }

    return signal.id;
  }

  /**
   * Get signals for user feed
   */
  async getFeedForUser(userId: string): Promise<SocialPost[]> {
    const followedCreators = this.followers.get(userId) || [];
    const allPosts: SocialPost[] = [];

    // Get signals from followed creators
    for (const creatorId of followedCreators) {
      const recentSignals = this.signals.filter(s => s.creatorId === creatorId);
      allPosts.push(...recentSignals.map(s => ({
        id: s.id,
        type: ContentType.TRADING_SIGNAL as string,
        creatorId: s.creatorId,
        content: JSON.stringify(s),
        postedAt: s.postedAt,
        likes: 0,
        comments: 0
      })));
    }

    return allPosts.slice(0, 50);
  }

  /**
   * Follow a creator
   */
  async followCreator(userId: string, creatorId: string): Promise<void> {
    const creator = this.creators.get(creatorId);
    if (!creator) throw new Error('Creator not found');

    if (!this.followers.has(userId)) {
      this.followers.set(userId, []);
    }
    
    const following = this.followers.get(userId)!;
    if (!following.includes(creatorId)) {
      following.push(creatorId);
      creator.followerCount++;
    }
  }

  /**
   * Get trending creators
   */
  async getTrendingCreators(): Promise<CreatorSummary[]> {
    return Array.from(this.creators.values())
      .filter(c => c.status === 'approved')
      .sort((a, b) => b.followerCount - a.followerCount)
      .slice(0, 20)
      .map(c => ({
        id: c.id,
        displayName: c.displayName,
        followers: c.followerCount,
        specialties: c.specialties,
        verifiedPositions: c.verifiedPositions
      }));
  }

  /**
   * Calculate influencer rewards
   */
  async calculateRewards(periodStart: Date, periodEnd: Date): Promise<RewardPayment[]> {
    const payments: RewardPayment[] = [];

    for (const creator of this.creators.values()) {
      if (creator.status !== 'approved') continue;

      // Get signals in period
      const signals = this.signals.filter(s => 
        s.creatorId === creator.id && 
        s.postedAt >= periodStart && 
        s.postedAt <= periodEnd
      );

      // Get follower count at period end
      let followerCount = 0;
      for (const [userId, following] of this.followers) {
        if (following.includes(creator.id)) followerCount++;
      }

      // Calculate reward (simplified formula)
      const baseReward = signals.length * 10;
      const followerBonus = followerCount * 0.01;
      const total = Math.round(baseReward + followerBonus);

      if (total > 0) {
        payments.push({
          creatorId: creator.id,
          userId: creator.userId,
          signalsCount: signals.length,
          followerCount,
          reward: total,
          period: `${periodStart.toISOString()} to ${periodEnd.toISOString()}`
        });
      }
    }

    return payments;
  }
}

interface CreatorApplication {
  userId: string;
  displayName: string;
  bio: string;
  specialties: string[];
}

interface Creator {
  id: string;
  userId: string;
  displayName: string;
  bio: string;
  specialties: string[];
  status: string;
  followerCount: number;
  verifiedPositions: number;
  totalPnl: number;
  totalSignalsPosted: number;
  appliedAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
}

interface SignalInput {
  creatorId: string;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  targetPrices: number[];
  stopLoss?: number;
  positionSize: number;
  confidence: number;
  reasoning: string;
  validForHours?: number;
}

interface TradingSignal {
  id: string;
  creatorId: string;
  type: string;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  targetPrices: number[];
  stopLoss?: number;
  positionSize: number;
  confidence: number;
  reasoning: string;
  postedAt: Date;
  expiresAt: Date;
}

interface SocialPost {
  id: string;
  type: string;
  creatorId: string;
  content: string;
  postedAt: Date;
  likes: number;
  comments: number;
}

interface CreatorSummary {
  id: string;
  displayName: string;
  followers: number;
  specialties: string[];
  verifiedPositions: number;
}

interface RewardPayment {
  creatorId: string;
  userId: string;
  signalsCount: number;
  followerCount: number;
  reward: number;
  period: string;
}

export { ContentType };