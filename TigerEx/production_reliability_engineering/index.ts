/**
 * Production Reliability Engineering Platform
 * 
 * SLO management, brownout protection, automated remediation.
 */

export enum SLOStatus {
  HEALTHY = 'healthy',
  AT_RISK = 'at_risk',
  BREACHED = 'breached'
}

export class ProductionReliabilityPlatform {
  private slos: Map<string, SLO> = new Map();
  private errorBudgets: Map<string, ErrorBudget> = new Map();
  private latencyBudgets: Map<string, LatencyBudget> = new Map();

  /**
   * Define SLO for a service
   */
  defineSLO(service: string, slo: SLOConfig): void {
    const target = 1 - (slo.errorRatePercent / 100);
    const budget = Math.ceil(slo.requestVolume * slo.errorRatePercent / 100);
    
    this.slos.set(service, {
      service,
      availabilityTarget: target,
      latencyTarget: slo.latencyTarget,
      period: slo.period,
      status: SLOStatus.HEALTHY,
      createdAt: new Date()
    });

    this.errorBudgets.set(service, {
      service,
      totalBudget: budget,
      consumed: 0,
      resetAt: new Date(Date.now() + slo.period)
    });

    this.latencyBudgets.set(service, {
      service,
      threshold: slo.latencyTarget,
      exceededSequences: 0
    });
  }

  /**
   * Record request outcome
   */
  async recordRequest(service: string, result: ServiceResult): Promise<void> {
    const budget = this.errorBudgets.get(service);
    if (!budget) return;

    // Only decrement on errors
    if (!result.success) {
      budget.consumed++;
    }

    // Check budget
    await this.checkErrorBudget(service);
    await this.checkLatency(service, result.latency);
  }

  /**
   * Get SLO for service
   */
  async getSLOStatus(service: string): Promise<SLOReport> {
    const slo = this.slos.get(service);
    const budget = this.errorBudgets.get(service);
    const latency = this.latencyBudgets.get(service);

    if (!slo) throw new Error('SLO not found');

    const errorRate = (budget!.consumed / (budget!.totalBudget + budget!.consumed)) * 100;
    const status = this.determineStatus(errorRate, latency!);

    return {
      service,
      status,
      errorRate: errorRate.toFixed(4) + '%',
      errorsUsed: budget!.consumed,
      errorBudget: budget!.totalBudget,
      latencyP99: latency!.currentP99,
      fetchedAt: new Date()
    };
  }

  /**
   * Trigger automated remediation
   */
  async triggerRemediation(service: string, alertType: string): Promise<RemediationAction> {
    // Determine action based on alert
    const actions: Record<string, () => RemediationAction> = {
      high_error_rate: () => ({
        action: 'SCALE_UP',
        reason: 'High error rate detected',
        target: service,
        expectedImpact: 'Reduce errors by scaling'
      }),
      high_latency: () => ({
        action: 'CIRCUIT_BREAK',
        reason: 'High latency detected',
        target: service,
        expectedImpact: 'Prevent cascading failures'
      }),
      out_of_errors: () => ({
        action: 'PAGE_ONCALL',
        reason: 'Error budget exhausted',
        target: service,
        expectedImpact: 'Immediate attention required'
      })
    };

    const actionFn = actions[alertType] || (() => ({
      action: 'INVESTIGATE',
      reason: alertType,
      target: service,
      expectedImpact: 'Unknown, manual investigate'
    }));

    return actionFn();
  }

  private async checkErrorBudget(service: string): Promise<void> {
    const budget = this.errorBudgets.get(service);
    const slo = this.slos.get(service);

    if (!budget || !slo) return;

    if (budget.consumed >= budget.totalBudget) {
      slo.status = SLOStatus.BREACHED;
      await this.triggerRemediation(service, 'out_of_errors');
    } else if (budget.consumed >= budget.totalBudget * 0.8) {
      slo.status = SLOStatus.AT_RISK;
    }
  }

  private async checkLatency(service: string, latency?: number): Promise<void> {
    const latencyBudget = this.latencyBudgets.get(service);
    if (!latencyBudget || !latency) return;

    // Simplified P99 tracking
    latencyBudget.currentP99 = (latencyBudget.currentP99 * 0.95) + (latency * 0.05);

    if (latencyBudget.currentP99 > latencyBudget.threshold * 2) {
      latencyBudget.exceededSequences++;
      await this.triggerRemediation(service, 'high_latency');
    }
  }

  private determineStatus(errorRate: number, latency: LatencyBudget): SLOStatus {
    if (errorRate > 1 || latency.exceededSequences > 5) return SLOStatus.BREACHED;
    if (errorRate > 0.5 || latency.exceededSequences > 2) return SLOStatus.AT_RISK;
    return SLOStatus.HEALTHY;
  }
}

interface SLOConfig {
  errorRatePercent: number;
  latencyTarget: number;
  period: number;
  requestVolume: number;
}

interface SLO {
  service: string;
  availabilityTarget: number;
  latencyTarget: number;
  period: number;
  status: SLOStatus;
  createdAt: Date;
}

interface ErrorBudget {
  service: string;
  totalBudget: number;
  consumed: number;
  resetAt: Date;
}

interface LatencyBudget {
  service: string;
  threshold: number;
  exceededSequences: number;
  currentP99?: number;
}

interface ServiceResult {
  success: boolean;
  latency?: number;
}

interface SLOReport {
  service: string;
  status: SLOStatus;
  errorRate: string;
  errorsUsed: number;
  errorBudget: number;
  latencyP99?: number;
  fetchedAt: Date;
}

interface RemediationAction {
  action: string;
  reason: string;
  target: string;
  expectedImpact: string;
}

export { SLOStatus };