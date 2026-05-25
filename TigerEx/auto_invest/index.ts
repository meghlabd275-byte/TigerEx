/**
 * TIGEREX AUTO-INVEST PLATFORM
 * DCA, recurring buys, dollar-cost averaging
 */

export interface InvestmentPlan {
  id: string;
  userId: string;
  asset: string;
  amount: number;
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  nextExecution: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  totalInvested: number;
  executions: number;
}

export class AutoInvestPlatform {
  private plans = new Map();
  private executions = new Map();
  private counter: number = 0;
  
  async createPlan(params: { userId: string; asset: string; amount: number; frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'; startDate?: number }) {
    const freqMs = { daily: 86400000, weekly: 604800000, biweekly: 1209600000, monthly: 2592000000 };
    const plan: InvestmentPlan = {
      id: `PLAN_${++this.counter}`,
      userId: params.userId,
      asset: params.asset,
      amount: params.amount,
      frequency: params.frequency,
      nextExecution: params.startDate || Date.now() + freqMs[params.frequency],
      status: 'active',
      totalInvested: 0,
      executions: 0
    };
    this.plans.set(plan.id, plan);
    return plan;
  }
  
  async executePlan(planId: string) {
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== 'active') return { error: 'Plan not found or inactive' };
    const execId = `EXE_${++this.counter}`;
    this.executions.set(execId, { planId, executedAt: Date.now(), amount: plan.amount });
    plan.totalInvested += plan.amount;
    plan.executions++;
    return { executed: true, executionId: execId };
  }
  
  async pause(planId: string) {
    const plan = this.plans.get(planId);
    if (plan) plan.status = 'paused';
    return { paused: true };
  }
  
  async resume(planId: string) {
    const plan = this.plans.get(planId);
    if (plan) plan.status = 'active';
    return { resumed: true };
  }
  
  async cancel(planId: string) {
    const plan = this.plans.get(planId);
    if (plan) plan.status = 'cancelled';
    return { cancelled: true };
  }
  
  async getPlans(userId: string) {
    return Array.from(this.plans.values()).filter(p => p.userId === userId);
  }

  // Legacy API compatibility
  async createRecurringBuy(params: { symbol: string; amount: number; frequency: string }) {
    return this.createPlan({ userId: params.symbol, asset: params.symbol, amount: params.amount, frequency: params.frequency as any });
  }
  async pauseRecurringBuy(orderId: string) { return this.pause(orderId); }
}

export default AutoInvestPlatform;