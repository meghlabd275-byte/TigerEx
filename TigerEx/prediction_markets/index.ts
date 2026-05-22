/** Prediction Markets Platform - Polymarket, Augur Style Features
 * 
 * Event-based prediction markets, binary options, sports, elections, crypto outcomes
 * Outcome tokens (YES/NO), liquidity pools, oracle resolution
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';

// ============================================================
// TYPES & INTERFACES
// ============================================================

export enum MarketCategory {
  ELECTION = 'election',
  SPORTS = 'sports',
  CRYPTO = 'crypto',
  ECONOMICS = 'economics',
  SCIENCE = 'science',
  ENTERTAINMENT = 'entertainment',
  WEATHER = 'weather'
}

export enum MarketStatus {
  UPCOMING = 'upcoming',
  TRADING = 'trading',
  RESOLVED = 'resolved',
  CANCELLED = 'cancelled'
}

export enum OutcomeResolution {
  YES = 'yes',
  NO = 'no',
  DRAW = 'draw',
  CANCELLED = 'cancelled'
}

export enum OrderType {
  BUY_YES = 'buy_yes',
  BUY_NO = 'buy_no',
  SELL_YES = 'sell_yes',
  SELL_NO = 'sell_no'
}

export interface PredictionMarket {
  id: string;
  question: string;
  description: string;
  category: MarketCategory;
  image_url?: string;
  start_date: Date;
  end_date: Date;
  resolution_date: Date;
  oracle_source: string;
  oracle_address?: string;
  initial_liquidity: number;
  yes_price: number;
  no_price: number;
  total_volume: number;
  total_trades: number;
  yes_holders: number;
  no_holders: number;
  status: MarketStatus;
  resolved_outcome?: OutcomeResolution;
  created_at: Date;
}

export interface PMOrder {
  id: string;
  market_id: string;
  user_id: string;
  outcome: 'yes' | 'no';
  order_type: OrderType;
  amount: number;
  price_limit: number;
  filled_amount: number;
  filled_price: number;
  status: 'pending' | 'filled' | 'cancelled' | 'expired';
  created_at: Date;
  filled_at?: Date;
}

export interface PMPosition {
  id: string;
  market_id: string;
  user_id: string;
  outcome: 'yes' | 'no';
  amount: number;
  avg_price: number;
  unrealized_pnl: number;
  realized_pnl: number;
}

export interface OracleResolution {
  market_id: string;
  outcome: OutcomeResolution;
  source: string;
  tx_hash?: string;
  timestamp: Date;
}

// ============================================================
// PREDICTION MARKETS ENGINE
// ============================================================

export class PredictionMarkets {
  private logger: Logger;
  private markets: Map<string, PredictionMarket> = new Map();
  private orders: Map<string, PMOrder> = new Map();
  private positions: Map<string, PMPosition> = new Map();
  private eventEmitter: EventEmitter;
  private oracles: Map<string, string> = new Map();
  
  // Market config
  private readonly PROPOSAL_THRESHOLD = 0.01; // Minimum $1 proposal deposit
  private readonly MIN_LIQUIDITY = 1000;
  private readonly TRADING_FEE = 0.02; // 2%
  private readonly SETTLEMENT_FEE = 0.03; // 3%
  
  constructor() {
    this.logger = new Logger('PredictionMarkets');
    this.eventEmitter = new EventEmitter();
    this.initializeOracles();
  }

  private initializeOracles(): void {
    // Register oracle sources
    this.oracles.set('chainlink', '0xChainlinkOracle');
    this.oracles.set('uniswap', '0xUniswapOracle');
    this.oracles.set('builtin', '0xBuiltinOracle');
    this.oracles.set('admin', '0xAdminOracle');
  }

  // ============================================================
  // MARKET CREATION
  // ============================================================

  /**
   * Create new prediction market
   */
  async createMarket(params: {
    question: string;
    description: string;
    category: MarketCategory;
    image_url?: string;
    start_date: Date;
    end_date: Date;
    resolution_date: Date;
    oracle_source: string;
    initial_liquidity?: number;
  }): Promise<PredictionMarket> {
    // Validate dates
    if (params.end_date <= params.start_date) {
      throw new Error('End date must be after start date');
    }
    if (params.resolution_date <= params.end_date) {
      throw new Error('Resolution date must be after end date');
    }

    // Validate oracle
    if (!this.oracles.has(params.oracle_source)) {
      throw new Error(`Unknown oracle source: ${params.oracle_source}`);
    }

    const market: PredictionMarket = {
      id: this.generateId(),
      question: params.question,
      description: params.description,
      category: params.category,
      image_url: params.image_url,
      start_date: params.start_date,
      end_date: params.end_date,
      resolution_date: params.resolution_date,
      oracle_source: this.oracles.get(params.oracle_source)!,
      initial_liquidity: params.initial_liquidity || this.MIN_LIQUIDITY,
      yes_price: 0.50,
      no_price: 0.50,
      total_volume: 0,
      total_trades: 0,
      yes_holders: 0,
      no_holders: 0,
      status: MarketStatus.UPCOMING,
      created_at: new Date()
    };

    this.markets.set(market.id, market);
    this.eventEmitter.emit('market_created', market);
    this.logger.info(`Prediction market created: ${market.id} - ${params.question}`);
    return market;
  }

  /**
   * Start trading on market (after proposal period)
   */
  async startTrading(marketId: string): Promise<void> {
    const market = this.markets.get(marketId);
    if (!market) throw new Error('Market not found');
    
    if (market.status !== MarketStatus.UPCOMING) {
      throw new Error('Market already started or resolved');
    }

    const now = new Date();
    if (now < market.start_date) {
      throw new Error('Trading not yet started');
    }

    market.status = MarketStatus.TRADING;
    this.markets.set(marketId, market);
    this.eventEmitter.emit('trading_started', market);
  }

  /**
   * Create markets in bulk for tournaments/competitions
   */
  async createMarketBatch(params: {
    questions: string[];
    category: MarketCategory;
    resolution_date: Date;
    oracle_source: string;
  }[]): Promise<PredictionMarket[]> {
    const results: PredictionMarket[] = [];
    for (const param of params) {
      const market = await this.createMarket({
        question: param.questions[0],
        description: '',
        category: param.category,
        resolution_date: param.resolution_date,
        oracle_source: param.oracle_source,
        start_date: new Date(),
        end_date: param.resolution_date
      });
      results.push(market);
    }
    return results;
  }

  // ============================================================
  // TRADING
  // ============================================================

  /**
   * Place order on prediction market
   */
  async placeOrder(params: {
    market_id: string;
    user_id: string;
    outcome: 'yes' | 'no';
    order_type: OrderType;
    amount: number;
    price_limit?: number;
  }): Promise<PMOrder> {
    const market = this.markets.get(params.market_id);
    if (!market) throw new Error('Market not found');
    
    if (market.status !== MarketStatus.TRADING) {
      throw new Error('Market not open for trading');
    }

    const now = new Date();
    if (now > market.end_date) {
      throw new Error('Trading period ended');
    }

    const currentPrice = params.outcome === 'yes' ? market.yes_price : market.no_price;
    const priceLimit = params.price_limit || currentPrice;

    // Check price limit
    if (params.order_type.includes('buy') && priceLimit < currentPrice) {
      throw new Error('Price limit below current price');
    }
    if (params.order_type.includes('sell') && priceLimit > currentPrice) {
      throw new Error('Price limit above current price');
    }

    const order: PMOrder = {
      id: this.generateId(),
      market_id: params.market_id,
      user_id: params.user_id,
      outcome: params.outcome,
      order_type: params.order_type,
      amount: params.amount,
      price_limit: priceLimit,
      filled_amount: 0,
      filled_price: currentPrice,
      status: 'pending',
      created_at: new Date()
    };

    this.orders.set(order.id, order);
    
    // Try to execute immediately at market price
    await this.executeOrder(order.id);
    
    this.eventEmitter.emit('order_placed', order);
    return order;
  }

  /**
   * Execute order at current price
   */
  private async executeOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'pending') return;

    const market = this.markets.get(order.market_id);
    if (!market) return;

    const executedAmount = order.amount;
    const executedPrice = order.outcome === 'yes' ? market.yes_price : market.no_price;
    
    order.filled_amount = executedAmount;
    order.filled_price = executedPrice;
    order.status = 'filled';
    order.filled_at = new Date();
    this.orders.set(orderId, order);

    // Update or create position
    await this.updatePosition(order, executedAmount, executedPrice);

    // Update market stats
    const tradeVolume = executedAmount * executedPrice;
    market.total_volume += tradeVolume;
    market.total_trades++;
    if (order.outcome === 'yes') {
      market.yes_holders++;
    } else {
      market.no_holders++;
    }
    this.markets.set(order.market_id, market);

    this.eventEmitter.emit('order_filled', order);
  }

  /**
   * Update user position
   */
  private async updatePosition(order: PMOrder, amount: number, price: number): Promise<void> {
    const positionKey = `${order.market_id}_${order.user_id}_${order.outcome}`;
    let position = this.positions.get(positionKey);

    if (!position) {
      position = {
        id: positionKey,
        market_id: order.market_id,
        user_id: order.user_id,
        outcome: order.outcome,
        amount: 0,
        avg_price: 0,
        unrealized_pnl: 0,
        realized_pnl: 0
      };
    }

    // Calculate new average
    const totalCost = (position.amount * position.avg_price) + (amount * price);
    position.amount += amount;
    position.avg_price = position.amount > 0 ? totalCost / position.amount : 0;

    this.positions.set(positionKey, position);
  }

  /**
   * Calculate P&L for position
   */
  async calculatePnL(marketId: string, userId: string, outcome: 'yes' | 'no'): Promise<{
    invested: number;
    current_value: number;
    unrealized_pnl: number;
    realized_pnl: number;
  }> {
    const positionKey = `${marketId}_${userId}_${outcome}`;
    const position = this.positions.get(positionKey);
    if (!position) {
      return { invested: 0, current_value: 0, unrealized_pnl: 0, realized_pnl: 0 };
    }

    const market = this.markets.get(marketId);
    if (!market) return { invested: 0, current_value: 0, unrealized_pnl: 0, realized_pnl: 0 };

    const currentPrice = outcome === 'yes' ? market.yes_price : market.no_price;
    const currentValue = position.amount * currentPrice;
    const invested = position.amount * position.avg_price;
    const unrealized = currentValue - invested;

    return {
      invested,
      current_value: currentValue,
      unrealized_pnl: unrealized,
      realized_pnl: position.realized_pnl
    };
  }

  // ============================================================
  // RESOLUTION
  // ============================================================

  /**
   * Resolve market (oracle)
   */
  async resolveMarket(params: {
    market_id: string;
    outcome: OutcomeResolution;
    source: string;
    tx_hash?: string;
  }): Promise<void> {
    const market = this.markets.get(params.market_id);
    if (!market) throw new Error('Market not found');

    if (market.status !== MarketStatus.TRADING && market.status !== MarketStatus.UPCOMING) {
      throw new Error('Market already resolved');
    }

    // Verify resolution date
    const now = new Date();
    if (now < market.resolution_date) {
      throw new Error('Resolution date not yet reached');
    }

    // Verify oracle source
    if (!this.oracles.has(params.source)) {
      throw new Error('Invalid oracle source');
    }

    // Resolve market
    market.resolved_outcome = params.outcome;
    market.status = MarketStatus.RESOLVED;
    this.markets.set(params.market_id, market);

    // Settle all positions
    await this.settlePositions(params.market_id, params.outcome);

    this.eventEmitter.emit('market_resolved', { market, outcome: params.outcome });
    this.logger.info(`Market resolved: ${params.market_id} -> ${params.outcome}`);
  }

  /**
   * Settle all positions after resolution
   */
  private async settlePositions(marketId: string, outcome: OutcomeResolution): Promise<void> {
    const market = this.markets.get(marketId);
    if (!market) return;

    const winningOutcome = outcome === OutcomeResolution.YES ? 'yes' : 'no';

    for (const [key, position] of this.positions) {
      if (!key.startsWith(marketId)) continue;

      const isWinner = position.outcome === winningOutcome;
      const settlementPrice = isWinner ? 1 : 0;
      
      // Calculate final value
      const finalValue = position.amount * settlementPrice;
      const invested = position.amount * position.avg_price;
      const pnl = finalValue - invested;

      position.unrealized_pnl = pnl;
      position.realized_pnl += pnl;
      
      this.positions.set(key, position);
    }
  }

  /**
   * Cancel market
   */
  async cancelMarket(marketId: string, reason: string): Promise<void> {
    const market = this.markets.get(marketId);
    if (!market) throw new Error('Market not found');

    market.status = MarketStatus.CANCELLED;
    this.markets.set(marketId, market);

    // Cancel all pending orders
    for (const [orderId, order] of this.orders) {
      if (order.market_id === marketId && order.status === 'pending') {
        order.status = 'cancelled';
        this.orders.set(orderId, order);
      }
    }

    this.eventEmitter.emit('market_cancelled', { marketId, reason });
  }

  // ============================================================
  // QUERIES
  // ============================================================

  async getMarket(marketId: string): Promise<PredictionMarket | null> {
    return this.markets.get(marketId) || null;
  }

  async getMarkets(filters?: {
    category?: MarketCategory;
    status?: MarketStatus;
    limit?: number;
  }): Promise<PredictionMarket[]> {
    let results = Array.from(this.markets.values());

    if (filters?.category) {
      results = results.filter(m => m.category === filters.category);
    }
    if (filters?.status) {
      results = results.filter(m => m.status === filters.status);
    }

    results.sort((a, b) => b.total_volume - a.total_volume);
    return results.slice(0, filters?.limit || 50);
  }

  async getUserOrders(userId: string, marketId?: string): Promise<PMOrder[]> {
    let results = Array.from(this.orders.values())
      .filter(o => o.user_id === userId);
    
    if (marketId) {
      results = results.filter(o => o.market_id === marketId);
    }
    
    return results.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async getUserPositions(userId: string): Promise<PMPosition[]> {
    return Array.from(this.positions.values())
      .filter(p => p.user_id === userId && p.amount > 0);
  }

  async getMarketPrices(marketId: string): Promise<{ yes: number; no: number }> {
    const market = this.markets.get(marketId);
    if (!market) return { yes: 0, no: 0 };
    return { yes: market.yes_price, no: market.no_price };
  }

  // Analytics
  async getMarketAnalytics(marketId: string): Promise<{
    volume_24h: number;
    trades_24h: number;
    price_change_24h: number;
    liquidity: number;
    holder_distribution: { yes: number; no: number };
  }> {
    const market = this.markets.get(marketId);
    if (!market) throw new Error('Market not found');

    return {
      volume_24h: market.total_volume,
      trades_24h: market.total_trades,
      price_change_24h: 0,
      liquidity: market.initial_liquidity,
      holder_distribution: {
        yes: market.yes_holders,
        no: market.no_holders
      }
    };
  }

  // ============================================================
  // CHART DATA
  // ============================================================

  async getHistoricalPrices(marketId: string, interval: string = '1h'): Promise<{
    timestamp: number;
    yes_price: number;
    no_price: number;
    volume: number;
  }[]> {
    // Would fetch from time-series database
    // Return mock for demonstration
    const market = this.markets.get(marketId);
    if (!market) return [];

    const data = [];
    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      data.push({
        timestamp: now - (i * 3600000),
        yes_price: market.yes_price,
        no_price: market.no_price,
        volume: market.total_volume / 24
      });
    }
    return data;
  }

  // ============================================================
  // TOURNAMENTS
  // ============================================================

  /**
   * Get tournament leaderboard
   */
  async getTournamentLeaderboard(marketId: string, limit: number = 10): Promise<{
    rank: number;
    user_id: string;
    pnl: number;
    trades: number;
  }[]> {
    // Aggregate user positions
    const userPnLs = new Map<string, { pnl: number; trades: number }>();

    for (const [, position] of this.positions) {
      if (position.market_id !== marketId) continue;
      
      const existing = userPnLs.get(position.user_id) || { pnl: 0, trades: 0 };
      existing.pnl += position.unrealized_pnl;
      existing.trades++;
      userPnLs.set(position.user_id, existing);
    }

    return Array.from(userPnLs.entries())
      .map(([userId, data], index) => ({
        rank: index + 1,
        user_id: userId,
        pnl: data.pnl,
        trades: data.trades
      }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, limit);
  }

  // ============================================================
  // FUNDING & INCENTIVES
  // ============================================================

  /**
   * Add liquidity to market
   */
  async addLiquidity(marketId: string, amount: number): Promise<void> {
    const market = this.markets.get(marketId);
    if (!market) throw new Error('Market not found');

    market.initial_liquidity += amount;
    this.markets.set(marketId, market);
  }

  /**
   * Claim trading rewards
   */
  async claimRewards(userId: string, marketId: string): Promise<{ amount: number; tx_hash: string }> {
    const positionKey = `${marketId}_${userId}_yes`;
    const position = this.positions.get(positionKey);
    if (!position || position.realized_pnl <= 0) {
      throw new Error('No rewards to claim');
    }

    const amount = position.realized_pnl;
    position.realized_pnl = 0;
    this.positions.set(positionKey, position);

    return {
      amount,
      tx_hash: this.generateTxHash()
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private generateId(): string {
    return `pm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTxHash(): string {
    return `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
  }
}

export default PredictionMarkets;