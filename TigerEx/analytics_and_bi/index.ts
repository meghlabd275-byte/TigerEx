/**
 * Analytics & Business Intelligence Platform
 * 
 * Trading analytics, revenue reporting, user behavior
 */

export class AnalyticsPlatform {
  private events: AnalyticsEvent[] = [];

  track(event: AnalyticsEvent): void {
    this.events.push({ ...event, timestamp: new Date() });
  }

  async getTradingVolume(period: '24h' | '7d' | '30d'): Promise<VolumeMetrics> {
    const cutoff = new Date(Date.now() - (period === '24h' ? 86400000 : period === '7d' ? 604800000 : 2592000000));
    const recent = this.events.filter(e => e.timestamp! > cutoff && e.type === 'trade');
    const volume = recent.reduce((sum, e) => sum + (e.data.volume || 0), 0);
    return { volume, trades: recent.length, period };
  }

  async getRevenueBreakdown(): Promise<RevenueMetrics> {
    const fees = this.events.filter(e => e.type === 'fee');
    return {
      tradingFees: fees.reduce((s, e) => s + (e.data.trading || 0), 0),
      withdrawalFees: fees.reduce((s, e) => s + (e.data.withdrawal || 0), 0),
      earnFees: fees.reduce((s, e) => s + (e.data.earn || 0), 0),
      total: fees.reduce((s, e) => s + (e.data.amount || 0), 0)
    };
  }
}

interface AnalyticsEvent {
  type: string;
  userId: string;
  data: Record<string, unknown>;
  timestamp?: Date;
}

interface VolumeMetrics { volume: number; trades: number; period: string; }
interface RevenueMetrics { tradingFees: number; withdrawalFees: number; earnFees: number; total: number; }