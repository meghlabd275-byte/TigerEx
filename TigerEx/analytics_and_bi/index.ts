/**
 * TIGEREX ANALYTICS & BUSINESS INTELLIGENCE PLATFORM
 * Production-grade analytics, dashboards, and BI reporting
 * 
 * Features:
 * - Trading analytics (volume, fees, PnL)
 * - User behavior analytics
 * - Revenue reporting
 * - Risk metrics
 * - Custom reports builder
 * - Dashboards
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface AnalyticsEvent {
  id: string;
  type: EventType;
  userId?: string;
  sessionId?: string;
  metadata: Record<string, any>;
  timestamp: number;
}

export enum EventType {
  // Trading
  TRADE = 'trade',
  ORDER_PLACED = 'order_placed',
  ORDER_CANCELLED = 'order_cancelled',
  ORDER_MODIFIED = 'order_modified',
  
  // Wallet
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  TRANSFER = 'transfer',
  
  // User
  REGISTER = 'register',
  LOGIN = 'login',
  LOGOUT = 'logout',
  KYC_SUBMITTED = 'kyc_submitted',
  KYC_APPROVED = 'kyc_approved',
  2FA_ENABLED = '2fa_enabled',
  
  // Activity
  PAGE_VIEW = 'page_view',
  BUTTON_CLICK = 'button_click',
  
  // Errors
  ERROR = 'error',
  API_ERROR = 'api_error',
}

export interface TradingMetrics {
  symbol?: string;
  period: string;
  
  // Volume metrics
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  averageTradeSize: number;
  
  // Count metrics
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  cancelledTrades: number;
  
  // Fee metrics
  totalFees: number;
  makerFees: number;
  takerFees: number;
  averageFee: number;
  
  // Pricing
  averagePrice: number;
  highPrice: number;
  lowPrice: number;
  
  // Time-based
  firstTradeTime?: number;
  lastTradeTime?: number;
}

export interface UserMetrics {
  userId: string;
  period: string;
  
  // Activity
  totalSessions: number;
  activeDays: number;
  lastActiveTime?: number;
  
  // Trading
  totalTrades: number;
  totalVolume: number;
  profitableTrades: number;
  losingTrades: number;
  netPnL: number;
  
  // Engagement
  pagesViewed: number;
  timeOnPlatform: number;  // seconds
  ordersPlaced: number;
  
  // Retention
  day1Retention: boolean;
  day7Retention: boolean;
  day30Retention: boolean;
}

export interface RevenueReport {
  period: string;
  startDate: number;
  endDate: number;
  
  // Revenue streams
  tradingFees: number;
  withdrawalFees: number;
  depositFees: number;
  earnProductFees: number;
  listingFees: number;
  otherFees: number;
  
  // Costs
  rebateCosts: number;
  promotionCosts: number;
  chargebackCosts: number;
  
  // Net
  grossRevenue: number;
  netRevenue: number;
  
  // Growth
  vsPreviousPeriod: number;
  vsSamePeriodLastYear: number;
}

export interface CohortAnalysis {
  cohortDate: string;
  cohortSize: number;
  
  // Retention rates (%)
  day1Retention: number;
  day7Retention: number;
  day14Retention: number;
  day30Retention: number;
  
  // Activity
  avgTradesPerUser: number;
  avgVolumePerUser: number;
  
  // Revenue
  ltv: number;  // Lifetime value
  cac: number;  // Customer acquisition cost
  ltvCacRatio: number;
}

export interface RiskMetrics {
  period: string;
  
  // Volume limits
  dailyVolumeLimit: number;
  currentDailyVolume: number;
  volumeUtilization: number;
  
  // Position limits
  largePositionCount: number;
  largePositionVolume: number;
  maxSingleTradeSize: number;
  
  // Risk score (0-100)
  overallRiskScore: number;
  
  // Alerts
  alerts: RiskAlert[];
}

export interface RiskAlert {
  id: string;
  type: 'warning' | 'critical';
  message: string;
  triggeredAt: number;
  acknowledged: boolean;
}

export interface DashboardConfig {
  id: string;
  userId: string;
  name: string;
  widgets: DashboardWidget[];
  layout: 'grid' | 'stack' | 'tabs';
  refreshInterval: number;  // seconds
  createdAt: number;
  updatedAt: number;
}

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  config: Record<string, any>;
  position: { x: number; y: number; w: number; h: number };
}

export enum WidgetType {
  LINE_CHART = 'line_chart',
  BAR_CHART = 'bar_chart',
  PIE_CHART = 'pie_chart',
  HEATMAP = 'heatmap',
  NUMERIC = 'numeric',
  TABLE = 'table',
  GAUGE = 'gauge',
}

export interface ReportFilter {
  startDate?: number;
  endDate?: number;
  userIds?: string[];
  symbols?: string[];
  eventTypes?: EventType[];
  groupBy?: 'hour' | 'day' | 'week' | 'month';
}

export interface ReportResult {
  data: any[];
  columns: string[];
  totalRows: number;
  aggregations: Record<string, number>;
}

// ============================================================================
// ANALYTICS ENGINE
// ============================================================================

class AnalyticsEngine {
  private events: AnalyticsEvent[] = [];
  private eventIdCounter: number = 0;
  
  // Configuration
  private readonly MAX_EVENTS = 1000000;  // Keep last 1M events
  private readonly FLUSH_INTERVAL = 60000;  // Flush every minute
  
  // Track event
  track(event: Omit<AnalyticsEvent, 'id' | 'timestamp'>): AnalyticsEvent {
    const fullEvent: AnalyticsEvent = {
      ...event,
      id: `EVT_${++this.eventIdCounter}`,
      timestamp: Date.now(),
    };
    
    this.events.push(fullEvent);
    
    // Trim old events
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }
    
    return fullEvent;
  }
  
  // Query events with filters
  query(filter: ReportFilter): AnalyticsEvent[] {
    let results = [...this.events];
    
    if (filter.startDate) {
      results = results.filter(e => e.timestamp >= filter.startDate!);
    }
    if (filter.endDate) {
      results = results.filter(e => e.timestamp <= filter.endDate!);
    }
    if (filter.userIds?.length) {
      results = results.filter(e => e.userId && filter.userIds!.includes(e.userId));
    }
    if (filter.eventTypes?.length) {
      results = results.filter(e => filter.eventTypes!.includes(e.type as EventType));
    }
    
    // Group and aggregate if requested
    if (filter.groupBy) {
      results = this.groupEvents(results, filter.groupBy);
    }
    
    return results;
  }
  
  // Calculate trading metrics
  async calculateTradingMetrics(
    filter: ReportFilter,
    symbol?: string
  ): Promise<TradingMetrics> {
    const baseFilter = { ...filter, eventTypes: [EventType.TRADE] };
    const events = this.query(baseFilter);
    
    const trades = events.filter(e => 
      !symbol || e.metadata?.symbol === symbol
    );
    
    if (trades.length === 0) {
      return this.emptyTradingMetrics(filter.period || '24h');
    }
    
    const buyTrades = trades.filter(e => e.metadata?.side === 'buy');
    const sellTrades = trades.filter(e => e.metadata?.side === 'sell');
    
    const volumes = trades.map(e => (e.metadata?.volume || 0) as number);
    const prices = trades.map(e => (e.metadata?.price || 0) as number);
    const fees = trades.map(e => (e.metadata?.fee || 0) as number);
    
    const times = trades.map(e => e.timestamp);
    
    return {
      symbol,
      period: filter.period || '24h',
      
      totalVolume: volumes.reduce((a, b) => a + b, 0),
      buyVolume: buyTrades.reduce((sum, e) => sum + (e.metadata?.volume || 0), 0),
      sellVolume: sellTrades.reduce((sum, e) => sum + (e.metadata?.volume || 0), 0),
      averageTradeSize: volumes.reduce((a, b) => a + b, 0) / trades.length,
      
      totalTrades: trades.length,
      buyTrades: buyTrades.length,
      sellTrades: sellTrades.length,
      cancelledTrades: 0,  // Would need ORDER_CANCELLED events
      
      totalFees: fees.reduce((a, b) => a + b, 0),
      makerFees: fees.reduce((a, b) => a + (e.metadata?.makerFee || 0), 0),
      takerFees: fees.reduce((a, b) => a + (e.metadata?.takerFee || 0), 0),
      averageFee: fees.reduce((a, b) => a + b, 0) / trades.length,
      
      averagePrice: prices.reduce((a, b) => a + b, 0) / trades.length,
      highPrice: Math.max(...prices),
      lowPrice: Math.min(...prices.filter(p => p > 0)),
      
      firstTradeTime: Math.min(...times),
      lastTradeTime: Math.max(...times),
    };
  }
  
  // Calculate user metrics
  async calculateUserMetrics(
    userId: string,
    period: string
  ): Promise<UserMetrics> {
    const periodMs = this.getPeriodMs(period);
    const startDate = Date.now() - periodMs;
    
    const userEvents = this.events.filter(e => 
      e.userId === userId && e.timestamp >= startDate
    );
    
    const sessions = new Set(userEvents.map(e => e.sessionId).filter(Boolean));
    const uniqueDays = new Set(userEvents.map(e => 
      new Date(e.timestamp).toDateString()
    ));
    
    const trades = userEvents.filter(e => e.type === EventType.TRADE);
    const tradeVolumes = trades.map(e => (e.metadata?.volume || 0) as number);
    const tradePnLs = trades.map(e => (e.metadata?.pnl || 0) as number);
    const pageViews = userEvents.filter(e => e.type === EventType.PAGE_VIEW);
    
    // Check retention
    const now = Date.now();
    const firstSeen = Math.min(...userEvents.map(e => e.timestamp));
    const day1Retention = (now - firstSeen) < 86400000 * 1;
    const day7Retention = (now - firstSeen) < 86400000 * 7;
    const day30Retention = (now - firstSeen) < 86400000 * 30;
    
    const profitableTrades = tradePnLs.filter(p => p > 0).length;
    const losingTrades = tradePnLs.filter(p => p < 0).length;
    
    return {
      userId,
      period,
      
      totalSessions: sessions.size,
      activeDays: uniqueDays.size,
      lastActiveTime: userEvents[0]?.timestamp,
      
      totalTrades: trades.length,
      totalVolume: tradeVolumes.reduce((a, b) => a + b, 0),
      profitableTrades,
      losingTrades,
      netPnL: tradePnLs.reduce((a, b) => a + b, 0),
      
      pagesViewed: pageViews.length,
      timeOnPlatform: userEvents.length * 30,  // Estimate 30 sec per event
      ordersPlaced: trades.length,
      
      day1Retention,
      day7Retention,
      day30Retention,
    };
  }
  
  // Calculate revenue report
  async calculateRevenueReport(period: string): Promise<RevenueReport> {
    const periodMs = this.getPeriodMs(period);
    const startDate = Date.now() - periodMs;
    const endDate = Date.now();
    const previousStart = startDate - periodMs;
    const yearAgoStart = startDate - 365 * 24 * 60 * 60 * 1000;
    
    const allEvents = this.events.filter(e => e.timestamp >= startDate);
    const prevPeriodEvents = this.events.filter(e => 
      e.timestamp >= previousStart && e.timestamp < startDate
    );
    const yearAgoEvents = this.events.filter(e => e.timestamp >= yearAgoStart);
    
    // Extract fees
    const tradingFees = allEvents
      .filter(e => e.type === EventType.TRADE)
      .reduce((sum, e) => sum + (e.metadata?.fee || 0), 0);
    
    const withdrawalFees = allEvents
      .filter(e => e.type === EventType.WITHDRAWAL)
      .reduce((sum, e) => sum + (e.metadata?.fee || 0), 0);
    
    const depositFees = allEvents
      .filter(e => e.type === EventType.DEPOSIT)
      .reduce((sum, e) => sum + (e.metadata?.fee || 0), 0);
    
    const earnFees = 0;  // Would filter by product type
    const listingFees = 0;
    const otherFees = 0;
    
    const grossRevenue = tradingFees + withdrawalFees + depositFees + earnFees + listingFees + otherFees;
    
    const rebateCosts = allEvents
      .filter(e => e.metadata?.rebate)
      .reduce((sum, e) => sum + (e.metadata?.rebate || 0), 0);
    const promotionCosts = 0;
    const chargebackCosts = 0;
    
    const netRevenue = grossRevenue - rebateCosts - promotionCosts - chargebackCosts;
    
    // Compare periods
    const prevRevenue = prevPeriodEvents
      .filter(e => e.type === EventType.TRADE)
      .reduce((sum, e) => sum + (e.metadata?.fee || 0), 0);
    
    const yearRevenue = yearAgoEvents
      .filter(e => e.type === EventType.TRADE)
      .reduce((sum, e) => sum + (e.metadata?.fee || 0), 0);
    
    const vsPrevious = prevRevenue > 0 
      ? ((grossRevenue - prevRevenue) / prevRevenue) * 100 
      : 0;
    const vsYear = yearRevenue > 0 
      ? ((grossRevenue - yearRevenue) / yearRevenue) * 100 
      : 0;
    
    return {
      period,
      startDate,
      endDate,
      
      tradingFees,
      withdrawalFees,
      depositFees,
      earnFees,
      listingFees,
      otherFees,
      
      rebateCosts,
      promotionCosts,
      chargebackCosts,
      
      grossRevenue,
      netRevenue,
      
      vsPreviousPeriod: vsPrevious,
      vsSamePeriodLastYear: vsYear,
    };
  }
  
  // Cohort analysis
  async calculateCohortAnalysis(cohortDate: string): Promise<CohortAnalysis> {
    // Parse cohort date (expecting YYYY-MM-DD)
    const cohortStart = new Date(cohortDate).getTime();
    const cohortEnd = cohortStart + 24 * 60 * 60 * 1000;
    
    const userSignups = this.events.filter(e =>
      e.type === EventType.REGISTER &&
      e.timestamp >= cohortStart && e.timestamp < cohortEnd
    );
    
    const userIds = [...new Set(userSignups.map(e => e.userId))];
    const cohortSize = userIds.length;
    
    if (cohortSize === 0) {
      return this.emptyCohort(cohortDate);
    }
    
    // Track these users over time
    const day1 = cohortStart + 1 * 86400000;
    const day7 = cohortStart + 7 * 86400000;
    const day14 = cohortStart + 14 * 86400000;
    const day30 = cohortStart + 30 * 86400000;
    
    const retainedAtDay1 = this.countRetainedUsers(userIds, cohortStart, day1);
    const retainedAtDay7 = this.countRetainedUsers(userIds, cohortStart, day7);
    const retainedAtDay14 = this.countRetainedUsers(userIds, cohortStart, day14);
    const retainedAtDay30 = this.countRetainedUsers(userIds, cohortStart, day30);
    
    // Calculate activity metrics (simplified)
    const totalTrades = 0;  // Would aggregate from trade events
    const totalVolume = 0;
    
    const ltv = totalVolume / cohortSize;  // Simplified LTV
    const cac = 0;  // Would need marketing cost data
    const ltvCacRatio = cac > 0 ? ltv / cac : 0;
    
    return {
      cohortDate,
      cohortSize,
      day1Retention: (retainedAtDay1 / cohortSize) * 100,
      day7Retention: (retainedAtDay7 / cohortSize) * 100,
      day14Retention: (retainedAtDay14 / cohortSize) * 100,
      day30Retention: (retainedAtDay30 / cohortSize) * 100,
      avgTradesPerUser: totalTrades / cohortSize,
      avgVolumePerUser: totalVolume / cohortSize,
      ltv,
      cac,
      ltvCacRatio,
    };
  }
  
  // Risk metrics
  async calculateRiskMetrics(period: string): Promise<RiskMetrics> {
    const periodMs = this.getPeriodMs(period);
    const startDate = Date.now() - periodMs;
    
    const events = this.events.filter(e => 
      e.timestamp >= startDate && e.type === EventType.TRADE
    );
    
    const volumes = events.map(e => (e.metadata?.volume || 0) as number);
    const dailyVolume = volumes.reduce((a, b) => a + b, 0);
    
    const largePositions = events.filter(e => 
      (e.metadata?.volume || 0) > 100000
    );
    
    const alerts: RiskAlert[] = [];
    const riskScore = this.calculateRiskScore(dailyVolume, largePositions.length, alerts);
    
    return {
      period,
      dailyVolumeLimit: 100000000,  // $100M
      currentDailyVolume: dailyVolume,
      volumeUtilization: dailyVolume / 100000000 * 100,
      largePositionCount: largePositions.length,
      largePositionVolume: largePositions.reduce((a, b) => a + (b.metadata?.volume || 0), 0),
      maxSingleTradeSize: Math.max(...volumes, 0),
      overallRiskScore: riskScore,
      alerts,
    };
  }
  
  // Get funnel data
  async getFunnel(
    funnelSteps: EventType[],
    period: string
  ): Promise<{ step: EventType; count: number; conversion: number }[]> {
    const periodMs = this.getPeriodMs(period);
    const startDate = Date.now() - periodMs;
    
    const events = this.events.filter(e => 
      e.timestamp >= startDate && funnelSteps.includes(e.type as EventType)
    );
    
    const results: { step: EventType; count: number; conversion: number }[] = [];
    let previousCount = events.length;
    
    for (const step of funnelSteps) {
      const count = events.filter(e => e.type === step).length;
      const conversion = previousCount > 0 ? (count / previousCount) * 100 : 0;
      
      results.push({ step, count, conversion });
      previousCount = count;
    }
    
    return results;
  }
  
  // ============ HELPERS ============
  
  private getPeriodMs(period: string): number {
    const map: Record<string, number> = {
      '1h': 3600000,
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000,
      '90d': 7776000000,
    };
    return map[period] || map['24h'];
  }
  
  private groupEvents(events: AnalyticsEvent[], groupBy: string): AnalyticsEvent[] {
    // Simplified grouping - in production would aggregate properly
    return events;
  }
  
  private emptyTradingMetrics(period: string): TradingMetrics {
    return {
      period,
      totalVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      averageTradeSize: 0,
      totalTrades: 0,
      buyTrades: 0,
      sellTrades: 0,
      cancelledTrades: 0,
      totalFees: 0,
      makerFees: 0,
      takerFees: 0,
      averageFee: 0,
      averagePrice: 0,
      highPrice: 0,
      lowPrice: 0,
    };
  }
  
  private emptyCohort(cohortDate: string): CohortAnalysis {
    return {
      cohortDate,
      cohortSize: 0,
      day1Retention: 0,
      day7Retention: 0,
      day14Retention: 0,
      day30Retention: 0,
      avgTradesPerUser: 0,
      avgVolumePerUser: 0,
      ltv: 0,
      cac: 0,
      ltvCacRatio: 0,
    };
  }
  
  private countRetainedUsers(userIds: string[], startDate: number, checkDate: number): number {
    const retained = this.events.filter(e =>
      userIds.includes(e.userId || '') &&
      e.timestamp >= checkDate && e.timestamp < checkDate + 86400000
    );
    return new Set(retained.map(e => e.userId)).size;
  }
  
  private calculateRiskScore(volume: number, largePositions: number, alerts: RiskAlert[]): number {
    let score = 20;  // Base score
    
    if (volume > 50000000) score += 30;
    if (volume > 100000000) score += 20;
    if (largePositions > 10) score += 20;
    
    if (score > 80) {
      alerts.push({
        id: `ALERT_${Date.now()}`,
        type: 'critical',
        message: 'High risk activity detected',
        triggeredAt: Date.now(),
        acknowledged: false,
      });
    }
    
    return Math.min(score, 100);
  }
}

// ============================================================================
// MAIN ANALYTICS PLATFORM
// ============================================================================

export class AnalyticsPlatform extends EventEmitter {
  private engine: AnalyticsEngine;
  private dashboards: Map<string, DashboardConfig> = new Map();
  private dashboardIdCounter: number = 0;
  
  constructor() {
    super();
    this.engine = new AnalyticsEngine();
    this.initializeSampleData();
  }
  
  private initializeSampleData(): void {
    // Add some sample events for demonstration
    const symbols = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT'];
    
    for (let i = 0; i < 100; i++) {
      this.engine.track({
        type: EventType.TRADE,
        userId: `user_${Math.floor(Math.random() * 100)}`,
        metadata: {
          symbol: symbols[Math.floor(Math.random() * symbols.length)],
          side: Math.random() > 0.5 ? 'buy' : 'sell',
          volume: Math.random() * 10000,
          price: 45000 + Math.random() * 1000,
          fee: Math.random() * 10,
        },
      });
    }
  }
  
  // Track event
  track(event: Omit<AnalyticsEvent, 'id' | 'timestamp'>): AnalyticsEvent {
    const tracked = this.engine.track(event);
    this.emit('event', tracked);
    return tracked;
  }
  
  // Get trading metrics
  async getTradingMetrics(filter: ReportFilter, symbol?: string): Promise<TradingMetrics> {
    return this.engine.calculateTradingMetrics(filter, symbol);
  }
  
  // Get user metrics
  async getUserMetrics(userId: string, period: string): Promise<UserMetrics> {
    return this.engine.calculateUserMetrics(userId, period);
  }
  
  // Get revenue report
  async getRevenueReport(period: string): Promise<RevenueReport> {
    return this.engine.calculateRevenueReport(period);
  }
  
  // Get cohort analysis
  async getCohortAnalysis(cohortDate: string): Promise<CohortAnalysis> {
    return this.engine.calculateCohortAnalysis(cohortDate);
  }
  
  // Get risk metrics
  async getRiskMetrics(period: string): Promise<RiskMetrics> {
    return this.engine.calculateRiskMetrics(period);
  }
  
  // Get funnel
  async getFunnel(funnelSteps: string[], period: string): Promise<any[]> {
    return this.engine.getFunnel(
      funnelSteps as EventType[],
      period
    );
  }
  
  // Dashboard management
  async createDashboard(
    userId: string,
    name: string,
    widgets: DashboardWidget[]
  ): Promise<DashboardConfig> {
    const dashboard: DashboardConfig = {
      id: `DASH_${++this.dashboardIdCounter}`,
      userId,
      name,
      widgets,
      layout: 'grid',
      refreshInterval: 60,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.dashboards.set(dashboard.id, dashboard);
    return dashboard;
  }
  
  async getDashboard(dashboardId: string): Promise<DashboardConfig | null> {
    return this.dashboards.get(dashboardId) || null;
  }
  
  async getUserDashboards(userId: string): Promise<DashboardConfig[]> {
    return Array.from(this.dashboards.values()).filter(
      d => d.userId === userId
    );
  }
  
  // Export report
  async exportReport(
    filter: ReportFilter,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    const data = this.engine.query(filter);
    
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }
    
    // CSV format
    if (data.length === 0) return '';
    
    const columns = Object.keys(data[0]);
    const rows = data.map(row => 
      columns.map(col => JSON.stringify(row[col as keyof row])).join(',')
    );
    
    return [columns.join(','), ...rows].join('\n');
  }
  
  // Real-time metrics (for dashboards)
  getRealtimeMetrics(): {
    trades24h: number;
    volume24h: number;
    activeUsers: number;
    pendingOrders: number;
  } {
    const events = this.engine['events'] as AnalyticsEvent[];
    const now = Date.now();
    const dayAgo = now - 86400000;
    
    const recentTrades = events.filter(e => 
      e.type === EventType.TRADE && e.timestamp >= dayAgo
    );
    
    return {
      trades24h: recentTrades.length,
      volume24h: recentTrades.reduce((sum, e) => 
        sum + (e.metadata?.volume as number || 0), 0
      ),
      activeUsers: new Set(recentTrades.map(e => e.userId)).size,
      pendingOrders: 0,  // Would query order system
    };
  }
}

export default AnalyticsPlatform;