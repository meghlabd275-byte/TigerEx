/**
 * Market Surveillance Console
 * 
 * Real-time market manipulation detection and investigation.
 * Critical for regulatory compliance and institutional licensing.
 */

export enum ManipulationType {
  SPOOFING = 'spoofing',
  LAYERING = 'layering',
  WASH_TRADE = 'wash_trade',
  INSIDER_TRADING = 'insider_trading',
  CROSS_MARKET_MANIPULATION = 'cross_market_manipulation',
  QUOTE_STUFFING = 'quote_stuffing',
  ABUSIVE_LATENCY = 'abusive_latency'
}

export enum SurveillanceSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export class MarketSurveillanceConsole {
  private alerts: MarketAlert[] = [];
  private cases: ManipulationCase[] = [];
  private alertThresholds = this.getDefaultThresholds();

  /**
   * Process incoming trade for manipulation patterns
   */
  async analyzeTrade(trade: TradeData): Promise<MarketAlert[]> {
    const alerts: MarketAlert[] = [];
    
    // Check for spoofing
    const spoofResult = this.checkSpoofing(trade);
    if (spoofResult.score > this.alertThresholds.spoofing) {
      alerts.push(this.createAlert(ManipulationType.SPOOFING, spoofResult, trade));
    }
    
    // Check for layering
    const layerResult = this.checkLayering(trade);
    if (layerResult.score > this.alertThresholds.layering) {
      alerts.push(this.createAlert(ManipulationType.LAYERING, layerResult, trade));
    }
    
    // Check for wash trading
    const washResult = this.checkWashTrade(trade);
    if (washResult.score > this.alertThresholds.washTrade) {
      alerts.push(this.createAlert(ManipulationType.WASH_TRADE, washResult, trade));
    }
    
    return alerts;
  }

  /**
   * Create new surveillance case from alert
   */
  async createCaseFromAlert(alertId: string, assignedTo: string): Promise<string> {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) throw new Error('Alert not found');

    const caseId = `SURV-${Date.now()}`;
    const manipulationCase: ManipulationCase = {
      caseId,
      alertIds: [alertId],
      type: alert.type,
      status: 'open',
      severity: alert.severity,
      assignedTo,
      createdAt: new Date(),
      timeline: [{
        action: 'created_from_alert',
        timestamp: new Date(),
        actor: assignedTo
      }]
    };

    this.cases.push(caseId);
    alert.status = 'investigating';
    
    return caseId;
  }

  /**
   * Get active manipulation cases
   */
  async getActiveCases(): Promise<ManipulationCase[]> {
    return this.cases.filter(c => c.status !== 'closed');
  }

  /**
   * Close manipulation case with resolution
   */
  async closeCase(
    caseId: string, 
    resolution: string,
    closedBy: string,
    evidenceOfViolation: boolean
  ): Promise<void> {
    const manipulationCase = this.cases.find(c => c.caseId === caseId);
    if (!manipulationCase) throw new Error('Case not found');

    manipulationCase.status = closedBy;
    manipulationCase.resolution = resolution;
    manipulationCase.evidenceOfViolation = evidenceOfViolation;
    manipulationCase.timeline.push({
      action: 'closed',
      timestamp: new Date(),
      actor: closedBy,
      details: { resolution, evidenceOfViolation }
    });
  }

  private checkSpoofing(trade: TradeData): DetectionResult {
    // Simplified detection: large orders quickly cancelled
    const orderToTradeRatio = trade.orderQuantity / Math.max(trade.executedQuantity, 1);
    const timeAlive = trade.cancelTime - trade.orderTime;
    
    return {
      score: orderToTradeRatio > 10 && timeAlive < 5000 ? 85 : 20,
      confidence: orderToTradeRatio > 10 ? 75 : 30,
      details: { orderToTradeRatio, timeAlive }
    };
  }

  private checkLayering(trade: TradeData): DetectionResult {
    // Detection: multiple non-genuine orders at price levels
    return {
      score: trade.layersCount > 3 ? 70 : 10,
      confidence: 60,
      details: { layersCount: trade.layersCount }
    };
  }

  private checkWashTrade(trade: TradeData): DetectionResult {
    // Detection: circular trading between accounts
    return {
      score: trade.washTradeNetworkSize > 2 ? 80 : 15,
      confidence: 70,
      details: { networkSize: trade.washTradeNetworkSize }
    };
  }

  private createAlert(
    type: ManipulationType, 
    result: DetectionResult,
    trade: TradeData
  ): MarketAlert {
    const severity = result.score > 80 ? SurveillanceSeverity.CRITICAL
      : result.score > 60 ? SurveillanceSeverity.HIGH
      : result.score > 40 ? SurveillanceSeverity.MEDIUM
      : SurveillanceSeverity.LOW;

    const alert: MarketAlert = {
      id: `ALERT-${Date.now()}`,
      type,
      severity,
      score: result.score,
      confidence: result.confidence,
      symbol: trade.symbol,
      userId: trade.userId,
      details: result.details,
      detectedAt: new Date(),
      status: 'open'
    };

    this.alerts.push(alert);
    return alert;
  }

  private getDefaultThresholds() {
    return {
      spoofing: 60,
      layering: 50,
      washTrade: 55,
      quoteStuffing: 40,
      abusiveLatency: 45
    };
  }
}

interface TradeData {
  symbol: string;
  userId: string;
  orderQuantity: number;
  executedQuantity: number;
  orderTime: number;
  cancelTime: number;
  layersCount: number;
  washTradeNetworkSize: number;
}

interface DetectionResult {
  score: number;
  confidence: number;
  details: Record<string, unknown>;
}

interface MarketAlert {
  id: string;
  type: ManipulationType;
  severity: SurveillanceSeverity;
  score: number;
  confidence: number;
  symbol: string;
  userId: string;
  details: Record<string, unknown>;
  detectedAt: Date;
  status: string;
}

interface ManipulationCase {
  caseId: string;
  alertIds: string[];
  type: ManipulationType;
  status: string;
  severity: SurveillanceSeverity;
  assignedTo: string;
  resolution?: string;
  evidenceOfViolation?: boolean;
  createdAt: Date;
  timeline: Array<{
    action: string;
    timestamp: Date;
    actor: string;
    details?: Record<string, unknown>;
  }>;
}