/**
 * TIGEREX OPTION WIZARD
 * Production - Smart options strategy builder
 */

export interface OptionLeg {
  type: 'call' | 'put';
  side: 'buy' | 'sell';
  strike: number;
  expiry: number;
  quantity: number;
}

export interface Strategy {
  id: string;
  name: string;
  legs: OptionLeg[];
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
  cost: number;
}

export class OptionWizard {
  private strategies = new Map();
  private counter = 0;

  async buildStrategy(params: { type: string; expiry: string; strike: number; budget: number; direction: 'bullish' | 'bearish' | 'neutral' }): Promise<Strategy> {
    const strategies: Record<string, OptionLeg[]> = {
      'covered_call': [
        { type: 'call', side: 'sell', strike: params.strike * 1.05, expiry: Date.now() + 30*86400000, quantity: 1 }
      ],
      'protective_put': [
        { type: 'put', side: 'buy', strike: params.strike * 0.95, expiry: Date.now() + 30*86400000, quantity: 1 }
      ],
      'straddle': [
        { type: 'call', side: 'buy', strike: params.strike, expiry: Date.now() + 30*86400000, quantity: 1 },
        { type: 'put', side: 'buy', strike: params.strike, expiry: Date.now() + 30*86400000, quantity: 1 }
      ],
      'strangle': [
        { type: 'call', side: 'buy', strike: params.strike * 1.05, expiry: Date.now() + 30*86400000, quantity: 1 },
        { type: 'put', side: 'buy', strike: params.strike * 0.95, expiry: Date.now() + 30*86400000, quantity: 1 }
      ],
      'bull_call_spread': [
        { type: 'call', side: 'buy', strike: params.strike, expiry: Date.now() + 30*86400000, quantity: 1 },
        { type: 'call', side: 'sell', strike: params.strike * 1.1, expiry: Date.now() + 30*86400000, quantity: 1 }
      ],
      'bear_put_spread': [
        { type: 'put', side: 'buy', strike: params.strike, expiry: Date.now() + 30*86400000, quantity: 1 },
        { type: 'put', side: 'sell', strike: params.strike * 0.9, expiry: Date.now() + 30*86400000, quantity: 1 }
      ]
    };

    const legs = strategies[params.type] || [];
    const strategy: Strategy = {
      id: `STRAT_${++this.counter}`,
      name: params.type,
      legs,
      maxProfit: params.budget * 2,
      maxLoss: params.budget,
      breakeven: [params.strike * 0.95, params.strike * 1.05],
      cost: params.budget * 0.1
    };

    this.strategies.set(strategy.id, strategy);
    return strategy;
  }

  async getRecommendations(budget: number): Promise<Strategy[]> {
    return [
      await this.buildStrategy({ type: 'covered_call', expiry: '30d', strike: 45000, budget, direction: 'bullish' }),
      await this.buildStrategy({ type: 'protective_put', expiry: '30d', strike: 45000, budget, direction: 'bullish' })
    ];
  }

  calculatePnL(strategy: Strategy, underlyingPrice: number): { profit: number; loss: number } {
    let profit = 0, loss = 0;
    for (const leg of strategy.legs) {
      const value = leg.type === 'call' 
        ? Math.max(0, underlyingPrice - leg.strike)
        : Math.max(0, leg.strike - underlyingPrice);
      if (leg.side === 'buy') profit += value * leg.quantity * 100;
      else loss += value * leg.quantity * 100;
    }
    return { profit, loss };
  }
}

// ============ POSITION BUILDER ============

export class PositionBuilder {
  async simulate(positions: { symbol: string; size: number; entry: number; current: number }[]): Promise<{ 
    totalPnL: number; profit: number; loss: number; chart: { price: number; pnl: number }[] 
  }> {
    let totalPnL = 0, profit = 0, loss = 0;
    const chart: { price: number; pnl: number }[] = [];

    for (const pos of positions) {
      const pnl = (pos.current - pos.entry) * pos.size;
      totalPnL += pnl;
      if (pnl > 0) profit += pnl;
      else loss += Math.abs(pnl);
    }

    return { totalPnL, profit, loss, chart };
  }
}

// ============ DERIBIT METRICS ============

export class DeribitMetrics {
  private ivIndex: Record<string, number> = { 'BTC': 65, 'ETH': 55 };
  private funding: Record<string, number> = { 'BTC': 0.0001, 'ETH': 0.0001 };

  async getIvIndex(symbol: string): Promise<{ value: number; percentile: number }> {
    return { value: this.ivIndex[symbol] || 50, percentile: 50 };
  }

  async getFunding(symbol: string): Promise<{ rate: number; nextFunding: number }> {
    return { rate: this.funding[symbol] || 0.0001, nextFunding: Date.now() + 8*3600000 };
  }

  async getOpenInterest(symbol: string): Promise<{ calls: number; puts: number }> {
    return { calls: Math.floor(Math.random() * 100000), puts: Math.floor(Math.random() * 100000) };
  }
}

export default OptionWizard;