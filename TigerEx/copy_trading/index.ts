/**
 * TigerEx Copy Trading Platform
 * 
 * Comprehensive copy trading like Bitget, TigerEx, TigerEx, TigerEx
 * Features: Spot/Futures copy trading, lead traders, risk management, analytics
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';

// ============================================================
// TYPES & INTERFACES
// ============================================================

export enum CopyTradingMode {
  SPOT = 'spot',
  FUTURES = 'futures',
  UNIFIED = 'unified'
}

export enum TraderStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  CLOSED = 'closed'
}

export enum FollowerStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  STOPPED = 'stopped'
}

export enum AllocationMode {
  FIXED = 'fixed',
  PROPORTIONAL = 'proportional',
  SMART = 'smart'
}

export interface LeadTrader {
  id: string;
  user_id: string;
  username: string;
  avatar_url?: string;
  bio?: string;
  copy_mode: CopyTradingMode;
  total_followers: number;
  total_aum: number;
  pnl_24h: number;
  pnl_7d: number;
  pnl_30d: number;
  pnl_total: number;
  win_rate: number;
  avg_trade_duration: number;
  max_drawdown: number;
  risk_score: number;
  total_trades: number;
  profitable_trades: number;
  avg_trade_size: number;
  preferred_pairs: string[];
  status: TraderStatus;
  verified: boolean;
  elite: boolean; // Top performer badge
  created_at: Date;
}

export interface Follower {
  id: string;
  user_id: string;
  lead_trader_id: string;
  allocated_balance: number;
  copy_mode: CopyTradingMode;
  allocation_mode: AllocationMode;
  follow_max_slippage: number;
  max_position_per_trade: number;
  status: FollowerStatus;
  total_pnl: number;
  today_pnl: number;
  open_positions: number;
  realized_trades: number;
  enable_stop_loss: boolean;
  stop_loss_percentage: number;
  enable_take_profit: boolean;
  take_profit_percentage: number;
  enable_trailing_stop: boolean;
  trailing_distance: number;
  started_at: Date;
  updated_at: Date;
}

export interface CopiedOrder {
  id: string;
  follower_id: string;
  lead_trader_id: string;
  lead_order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: string;
  quantity: number;
  price: number;
  filled_price: number;
  slippage: number;
  status: 'pending' | 'filled' | 'cancelled' | 'failed';
  created_at: Date;
  filled_at?: Date;
}

export interface TraderPerformance {
  trader_id: string;
  period: '24h' | '7d' | '30d' | 'total';
  pnl: number;
  pnl_percentage: number;
  trades: number;
  win_rate: number;
  avg_trade_pnl: number;
  max_drawdown: number;
  sharpe_ratio?: number;
}

export interface LeaderboardEntry {
  rank: number;
  trader_id: string;
  username: string;
  avatar_url?: string;
  pnl_30d: number;
  win_rate: number;
  total_trades: number;
  followers: number;
  verified: boolean;
  elite: boolean;
}

// ============================================================
// COPY TRADING ENGINE
// ============================================================

export class CopyTradingEngine {
  private logger: Logger;
  private leadTraders: Map<string, LeadTrader> = new Map();
  private followers: Map<string, Follower> = new Map();
  private orders: Map<string, CopiedOrder> = new Map();
  private eventEmitter: EventEmitter;
  
  // System config
  private readonly MIN_FOLLOW_BALANCE = 10; // $10 minimum
  private readonly MAX_FOLLOWERS_PER_TRADER = 10000;
  private readonly COPY_TIMEOUT_MS = 30000;
  private readonly MAX_SLIPPAGE_DEFAULT = 1; // 1%
  
  constructor() {
    this.logger = new Logger('CopyTradingEngine');
    this.eventEmitter = new EventEmitter();
  }

  // ============================================================
  // LEAD TRADER MANAGEMENT
  // ============================================================

  /**
   * Register as lead trader
   */
  async registerAsLeadTrader(params: {
    user_id: string;
    username: string;
    avatar_url?: string;
    bio?: string;
    copy_mode: CopyTradingMode;
    preferred_pairs: string[];
  }): Promise<LeadTrader> {
    // Check if already registered
    const existing = Array.from(this.leadTraders.values())
      .find(t => t.user_id === params.user_id);
    if (existing) {
      throw new Error('Already registered as lead trader');
    }

    const trader: LeadTrader = {
      id: this.generateId(),
      user_id: params.user_id,
      username: params.username,
      avatar_url: params.avatar_url,
      bio: params.bio,
      copy_mode: params.copy_mode,
      total_followers: 0,
      total_aum: 0,
      pnl_24h: 0,
      pnl_7d: 0,
      pnl_30d: 0,
      pnl_total: 0,
      win_rate: 0,
      avg_trade_duration: 0,
      max_drawdown: 0,
      risk_score: 50,
      total_trades: 0,
      profitable_trades: 0,
      avg_trade_size: 0,
      preferred_pairs: params.preferred_pairs,
      status: TraderStatus.ACTIVE,
      verified: false,
      elite: false,
      created_at: new Date()
    };

    this.leadTraders.set(trader.id, trader);
    this.eventEmitter.emit('lead_trader_registered', trader);
    this.logger.info(`Lead trader registered: ${trader.username}`);
    return trader;
  }

  /**
   * Update lead trader profile
   */
  async updateProfile(params: {
    trader_id: string;
    user_id: string;
    bio?: string;
    preferred_pairs?: string[];
  }): Promise<void> {
    const trader = this.findTraderByUser(params.user_id);
    if (!trader || trader.id !== params.trader_id) {
      throw new Error('Not authorized');
    }

    if (params.bio) trader.bio = params.bio;
    if (params.preferred_pairs) trader.preferred_pairs = params.preferred_pairs;
    this.leadTraders.set(trader.id, trader);
  }

  /**
   * Update lead trader P&L (called by trading engine)
   */
  async updateTraderPnL(params: {
    trader_id: string;
    pnl_24h: number;
    pnl_7d: number;
    pnl_30d: number;
    pnl_total: number;
    win_rate: number;
    total_trades: number;
    profitable_trades: number;
    max_drawdown: number;
  }): Promise<void> {
    const trader = this.leadTraders.get(params.trader_id);
    if (!trader) return;

    trader.pnl_24h = params.pnl_24h;
    trader.pnl_7d = params.pnl_7d;
    trader.pnl_30d = params.pnl_30d;
    trader.pnl_total = params.pnl_total;
    trader.win_rate = params.win_rate;
    trader.total_trades = params.total_trades;
    trader.profitable_trades = params.profitable_trades;
    trader.max_drawdown = params.max_drawdown;

    // Update elite status based on performance
    trader.elite = params.pnl_30d > 100 && params.win_rate > 60 && params.total_trades > 50;

    this.leadTraders.set(params.trader_id, trader);
  }

  /**
   * Pause/Resume trading (lead trader)
   */
  async setTraderStatus(params: {
    trader_id: string;
    user_id: string;
    status: TraderStatus;
  }): Promise<void> {
    const trader = this.findTraderByUser(params.user_id);
    if (!trader || trader.id !== params.trader_id) {
      throw new Error('Not authorized');
    }

    trader.status = params.status;
    this.leadTraders.set(trader.id, trader);
    this.eventEmitter.emit('trader_status_changed', trader);
  }

  // ============================================================
  // FOLLOWER MANAGEMENT
  // ============================================================

  /**
   * Start following a trader
   */
  async startFollowing(params: {
    user_id: string;
    lead_trader_id: string;
    allocated_balance: number;
    copy_mode: CopyTradingMode;
    allocation_mode?: AllocationMode;
    max_slippage?: number;
    max_position?: number;
    stop_loss_pct?: number;
    take_profit_pct?: number;
  }): Promise<Follower> {
    // Validate lead trader
    const leadTrader = this.leadTraders.get(params.lead_trader_id);
    if (!leadTrader) {
      throw new Error('Lead trader not found');
    }

    if (leadTrader.status !== TraderStatus.ACTIVE) {
      throw new Error('Lead trader is not active');
    }

    // Validate balance
    if (params.allocated_balance < this.MIN_FOLLOW_BALANCE) {
      throw new Error(`Minimum follow balance is $${this.MIN_FOLLOW_BALANCE}`);
    }

    // Check if already following
    const existingFollower = Array.from(this.followers.values())
      .find(f => f.user_id === params.user_id && f.lead_trader_id === params.lead_trader_id);
    if (existingFollower) {
      throw new Error('Already following this trader');
    }

    // Check max followers
    if (leadTrader.total_followers >= this.MAX_FOLLOWERS_PER_TRADER) {
      throw new Error('Lead trader has reached max followers');
    }

    const follower: Follower = {
      id: this.generateId(),
      user_id: params.user_id,
      lead_trader_id: params.lead_trader_id,
      allocated_balance: params.allocated_balance,
      copy_mode: params.copy_mode,
      allocation_mode: params.allocation_mode || AllocationMode.FIXED,
      follow_max_slippage: params.max_slippage || this.MAX_SLIPPAGE_DEFAULT,
      max_position_per_trade: params.max_position || params.allocated_balance * 0.2,
      status: FollowerStatus.ACTIVE,
      total_pnl: 0,
      today_pnl: 0,
      open_positions: 0,
      realized_trades: 0,
      enable_stop_loss: !!params.stop_loss_pct,
      stop_loss_percentage: params.stop_loss_pct || 0,
      enable_take_profit: !!params.take_profit_pct,
      take_profit_percentage: params.take_profit_pct || 0,
      enable_trailing_stop: false,
      trailing_distance: 0,
      started_at: new Date(),
      updated_at: new Date()
    };

    this.followers.set(follower.id, follower);

    // Update lead trader stats
    leadTrader.total_followers++;
    leadTrader.total_aum += params.allocated_balance;
    this.leadTraders.set(params.lead_trader_id, leadTrader);

    this.eventEmitter.emit('following_started', follower);
    this.logger.info(`User ${params.user_id} started following ${leadTrader.username}`);
    return follower;
  }

  /**
   * Adjust follow balance
   */
  async adjustAllocation(params: {
    follower_id: string;
    user_id: string;
    new_balance: number;
  }): Promise<void> {
    const follower = this.followers.get(params.follower_id);
    if (!follower || follower.user_id !== params.user_id) {
      throw new Error('Not found or not authorized');
    }

    if (new_balance < this.MIN_FOLLOW_BALANCE) {
      throw new Error(`Minimum balance is $${this.MIN_FOLLOW_BALANCE}`);
    }

    const balanceDiff = new_balance - follower.allocated_balance;
    follower.allocated_balance = new_balance;
    follower.updated_at = new Date();
    this.followers.set(params.follower_id, follower);

    // Update lead trader AUM
    const leadTrader = this.leadTraders.get(follower.lead_trader_id);
    if (leadTrader) {
      leadTrader.total_aum += balanceDiff;
      this.leadTraders.set(leadTrader.id, leadTrader);
    }

    this.eventEmitter.emit('allocation_adjusted', follower);
  }

  /**
   * Update risk settings
   */
  async updateRiskSettings(params: {
    follower_id: string;
    user_id: string;
    max_slippage?: number;
    max_position?: number;
    stop_loss_pct?: number;
    take_profit_pct?: number;
    trailing_distance?: number;
  }): Promise<void> {
    const follower = this.followers.get(params.follower_id);
    if (!follower || follower.user_id !== params.user_id) {
      throw new Error('Not found or not authorized');
    }

    if (params.max_slippage !== undefined) {
      follower.follow_max_slippage = params.max_slippage;
    }
    if (params.max_position !== undefined) {
      follower.max_position_per_trade = params.max_position;
    }
    if (params.stop_loss_pct !== undefined) {
      follower.enable_stop_loss = params.stop_loss_pct > 0;
      follower.stop_loss_percentage = params.stop_loss_pct;
    }
    if (params.take_profit_pct !== undefined) {
      follower.enable_take_profit = params.take_profit_pct > 0;
      follower.take_profit_percentage = params.take_profit_pct;
    }
    if (params.trailing_distance !== undefined) {
      follower.enable_trailing_stop = params.trailing_distance > 0;
      follower.trailing_distance = params.trailing_distance;
    }

    follower.updated_at = new Date();
    this.followers.set(params.follower_id, follower);
    this.eventEmitter.emit('risk_settings_updated', follower);
  }

  /**
   * Pause/Stop following
   */
  async updateFollowerStatus(params: {
    follower_id: string;
    user_id: string;
    status: FollowerStatus;
  }): Promise<void> {
    const follower = this.followers.get(params.follower_id);
    if (!follower || follower.user_id !== params.user_id) {
      throw new Error('Not found or not authorized');
    }

    follower.status = params.status;
    follower.updated_at = new Date();
    this.followers.set(params.follower_id, follower);
    this.eventEmitter.emit('follower_status_changed', follower);
  }

  /**
   * Stop following
   */
  async stopFollowing(params: {
    follower_id: string;
    user_id: string;
  }): Promise<{ total_pnl: number; realized_trades: number }> {
    const follower = this.followers.get(params.follower_id);
    if (!follower || follower.user_id !== params.user_id) {
      throw new Error('Not found or not authorized');
    }

    // Close all copied positions (would integrate with order system)
    const result = {
      total_pnl: follower.total_pnl,
      realized_trades: follower.realized_trades
    };

    // Update lead trader stats
    const leadTrader = this.leadTraders.get(follower.lead_trader_id);
    if (leadTrader) {
      leadTrader.total_followers = Math.max(0, leadTrader.total_followers - 1);
      leadTrader.total_aum -= follower.allocated_balance;
      this.leadTraders.set(leadTrader.id, leadTrader);
    }

    this.followers.delete(params.follower_id);
    this.eventEmitter.emit('following_stopped', result);
    this.logger.info(`User stopped following lead trader`);
    return result;
  }

  // ============================================================
  // ORDER SYNC (Core copy logic)
  // ============================================================

  /**
   * Sync/copy an order from lead trader to followers
   */
  async syncOrderFromLeadTrader(params: {
    lead_trader_id: string;
    symbol: string;
    side: 'buy' | 'sell';
    order_type: string;
    quantity: number;
    price: number;
    filled_price: number;
  }): Promise<{ copied_orders: CopiedOrder[] }> {
    const leadTrader = this.leadTraders.get(params.lead_trader_id);
    if (!leadTrader || leadTrader.status !== TraderStatus.ACTIVE) {
      return { copied_orders: [] };
    }

    // Get all active followers of this trader
    const activeFollowers = Array.from(this.followers.values())
      .filter(f => f.lead_trader_id === params.lead_trader_id && f.status === FollowerStatus.ACTIVE);

    const copiedOrders: CopiedOrder[] = [];
    const slippage = Math.abs((params.filled_price - params.price) / params.price * 100);

    for (const follower of activeFollowers) {
      // Skip if exceed slippage tolerance
      if (slippage > follower.follow_max_slippage) {
        this.eventEmitter.emit('order_skip_slippage', { follower, symbol: params.symbol, slippage });
        continue;
      }

      // Calculate position size based on allocation mode
      let quantityToCopy = follower.allocated_balance * 0.1; // Default 10% per trade
      if (follower.allocation_mode === AllocationMode.PROPORTIONAL) {
        quantityToCopy = params.quantity * (follower.allocated_balance / leadTrader.avg_trade_size);
      }
      // Cap at max position
      quantityToCopy = Math.min(quantityToCopy, follower.max_position_per_trade);

      const order: CopiedOrder = {
        id: this.generateId(),
        follower_id: follower.id,
        lead_trader_id: params.lead_trader_id,
        lead_order_id: '',
        symbol: params.symbol,
        side: params.side,
        order_type: params.order_type,
        quantity: quantityToCopy,
        price: params.price,
        filled_price: params.filled_price,
        slippage: slippage,
        status: 'pending',
        created_at: new Date()
      };

      this.orders.set(order.id, order);
      copiedOrders.push(order);

      follower.open_positions++;
      follower.updated_at = new Date();
      this.followers.set(follower.id, follower);

      this.eventEmitter.emit('order_copied', order);
    }

    this.logger.info(`Synced ${copiedOrders.length} copied orders for ${params.symbol}`);
    return { copied_orders: copiedOrders };
  }

  /**
   * Handle order fill (copy filled price back to followers)
   */
  async handleOrderFill(params: {
    order_id: string;
    filled_price: number;
    filled_quantity: number;
  }): Promise<void> {
    const order = this.orders.get(params.order_id);
    if (!order) return;

    order.filled_price = params.filled_price;
    order.quantity = params.filled_quantity;
    order.status = 'filled';
    order.filled_at = new Date();
    this.orders.set(params.order_id, order);
  }

  /**
   * Sync close order (when lead trader closes)
   */
  async syncCloseOrder(params: {
    lead_trader_id: string;
    symbol: string;
    pnl: number;
    side: 'buy' | 'sell';
  }): Promise<void> {
    const leadTrader = this.leadTraders.get(params.lead_trader_id);
    if (!leadTrader) return;

    const followers = Array.from(this.followers.values())
      .filter(f => f.lead_trader_id === params.lead_trader_id && f.status === FollowerStatus.ACTIVE);

    for (const follower of followers) {
      // Find open orders for this symbol
      const openOrders = Array.from(this.orders.values())
        .filter(o => o.follower_id === follower.id && o.symbol === params.symbol && o.status === 'filled');

      for (const order of openOrders) {
        // Calculate P&L proportionally (simplified)
        const proportion = order.quantity / follower.allocated_balance;
        const orderPnl = params.pnl * proportion;

        follower.total_pnl += orderPnl;
        follower.today_pnl += orderPnl;
        follower.open_positions = Math.max(0, follower.open_positions - 1);
        follower.realized_trades++;
        follower.updated_at = new Date();
        this.followers.set(follower.id, follower);

        this.eventEmitter.emit('position_closed', { follower, pnl: orderPnl });
      }
    }
  }

  // ============================================================
  // LEADERBOARD & DISCOVERY
  // ============================================================

  /**
   * Get top traders leaderboard
   */
  async getLeaderboard(params?: {
    mode?: CopyTradingMode;
    period?: '24h' | '7d' | '30d';
    limit?: number;
  }): Promise<LeaderboardEntry[]> {
    let traders = Array.from(this.leadTraders.values())
      .filter(t => t.status === TraderStatus.ACTIVE);

    // Filter by mode
    if (params?.mode) {
      traders = traders.filter(t => t.copy_mode === params.mode || t.copy_mode === CopyTradingMode.UNIFIED);
    }

    // Sort by period PnL
    const sortKey = params?.period === '24h' ? 'pnl_24h' : params?.period === '7d' ? 'pnl_7d' : 'pnl_30d';
    traders.sort((a, b) => (b as any)[sortKey] - (a as any)[sortKey]);

    const limit = params?.limit || 50;
    return traders.slice(0, limit).map((trader, index) => ({
      rank: index + 1,
      trader_id: trader.id,
      username: trader.username,
      avatar_url: trader.avatar_url,
      pnl_30d: trader.pnl_30d,
      win_rate: trader.win_rate,
      total_trades: trader.total_trades,
      followers: trader.total_followers,
      verified: trader.verified,
      elite: trader.elite
    }));
  }

  /**
   * Search traders
   */
  async searchTraders(query: string, limit: number = 20): Promise<LeadTrader[]> {
    const q = query.toLowerCase();
    return Array.from(this.leadTraders.values())
      .filter(t => t.status === TrainerStatus.ACTIVE)
      .filter(t => 
        t.username.toLowerCase().includes(q) ||
        t.preferred_pairs.some(p => p.toLowerCase().includes(q))
      )
      .slice(0, limit);
  }

  /**
   * Get recommended traders (for discovery)
   */
  async getRecommendedTraders(userId?: string, limit: number = 10): Promise<LeaderboardEntry[]> {
    // Would use ML/recommendation for personalized
    // Default: top performers with reasonable risk
    return this.getLeaderboard({ period: '30d', limit });
  }

  // ============================================================
  // ANALYTICS & REPORTING
  // ============================================================

  /**
   * Get trader performance stats
   */
  async getTraderPerformance(params: {
    trader_id: string;
    period: '24h' | '7d' | '30d' | 'total';
  }): Promise<TraderPerformance | null> {
    const trader = this.leadTraders.get(params.trader_id);
    if (!trader) return null;

    return {
      trader_id: params.trader_id,
      period: params.period,
      pnl: params.period === '24h' ? trader.pnl_24h : params.period === '7d' ? trader.pnl_7d : trader.pnl_total,
      pnl_percentage: 0, // Would calculate based on initial AUM
      trades: trader.total_trades,
      win_rate: trader.win_rate,
      avg_trade_pnl: trader.total_trades > 0 ? trader.pnl_total / trader.total_trades : 0,
      max_drawdown: trader.max_drawdown
    };
  }

  /**
   * Get follower dashboard
   */
  async getFollowerDashboard(userId: string): Promise<{
    total_following: number;
    total_invested: number;
    total_pnl: number;
    today_pnl: number;
    best_performer?: LeadTrader;
  }> {
    const userFollowers = Array.from(this.followers.values())
      .filter(f => f.user_id === userId);

    let totalInvested = 0;
    let totalPnl = 0;
    let todayPnl = 0;
    let bestPnl = 0;
    let bestPerformer: LeadTrader | undefined;

    for (const f of userFollowers) {
      totalInvested += f.allocated_balance;
      totalPnl += f.total_pnl;
      todayPnl += f.today_pnl;
      if (f.total_pnl > bestPnl) {
        bestPnl = f.total_pnl;
        bestPerformer = this.leadTraders.get(f.lead_trader_id);
      }
    }

    return {
      total_following: userFollowers.length,
      total_invested: totalInvested,
      total_pnl: totalPnl,
      today_pnl: todayPnl,
      best_performer: bestPerformer
    };
  }

  /**
   * Get detailed follower history
   */
  async getFollowerHistory(followerId: string): Promise<{
    orders: CopiedOrder[];
    pnl_history: { date: Date; pnl: number }[];
  }> {
    const follower = this.followers.get(followerId);
    if (!follower) {
      throw new Error('Follower not found');
    }

    const orders = Array.from(this.orders.values())
      .filter(o => o.follower_id === followerId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    return {
      orders: orders.slice(0, 100),
      pnl_history: [] // Would aggregate from realized trades
    };
  }

  // ============================================================
  // RISK MANAGEMENT
  // ============================================================

  /**
   * Calculate follower risk score
   */
  async calculateRiskScore(followerId: string): Promise<number> {
    const follower = this.followers.get(followerId);
    if (!follower) return 50;

    const leadTrader = this.leadTraders.get(follower.lead_trader_id);
    if (!leadTrader) return 50;

    // Combine lead trader risk with follower settings
    const traderRisk = leadTrader.risk_score;
    const settingsRisk = (follower.enable_stop_loss ? 20 : 0) + (follower.enable_take_profit ? 10 : 0);

    return Math.max(0, Math.min(100, traderRisk - settingsRisk));
  }

  /**
   * Trigger risk protection (stop loss, take profit)
   */
  async checkRiskProtection(followerId: string, currentPnl: number): Promise<{
  should_stop: boolean;
  reason?: string;
  }> {
    const follower = this.followers.get(followerId);
    if (!follower) return { should_stop: false };

    // Check stop loss
    if (follower.enable_stop_loss && currentPnl <= -follower.stop_loss_percentage) {
      follower.status = FollowerStatus.PAUSED;
      this.followers.set(followerId, follower);
      return { should_stop: true, reason: 'Stop loss triggered' };
    }

    // Check take profit
    if (follower.enable_take_profit && currentPnl >= follower.take_profit_percentage) {
      // Optional: could auto-close
    }

    return { should_stop: false };
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  private generateId(): string {
    return `cp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private findTraderByUser(userId: string): LeadTrader | undefined {
    return Array.from(this.leadTraders.values())
      .find(t => t.user_id === userId);
  }

  async getLeadTrader(traderId: string): Promise<LeadTrader | null> {
    return this.leadTraders.get(traderId) || null;
  }

  async getFollower(followerId: string): Promise<Follower | null> {
    return this.followers.get(followerId) || null;
  }

  async getFollowersByTrader(traderId: string): Promise<Follower[]> {
    return Array.from(this.followers.values())
      .filter(f => f.lead_trader_id === traderId);
  }

  async getUserFollowers(userId: string): Promise<Follower[]> {
    return Array.from(this.followers.values())
      .filter(f => f.user_id === userId);
  }
}

// Add missing enum reference fix
const TrainerStatus = { ACTIVE: 'active' };

export default CopyTradingEngine;