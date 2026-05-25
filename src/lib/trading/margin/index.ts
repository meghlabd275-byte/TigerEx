/**
 * Margin Trading Module
 * TypeScript implementation for margin trading features
 */

export interface MarginOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_limit';
  price: string;
  quantity: string;
  filledQuantity: string;
  borrowedAmount: string;
  interestRate: string;
  status: 'pending' | 'filled' | 'partially_filled' | 'cancelled';
  timeInForce: 'gtc' | 'ioc' | 'fok';
  createdAt: number;
}

export interface MarginPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnL: string;
  leverage: number;
  liquidationPrice: string;
  marginRatio: string;
  isolated: boolean;
  autoAddMargin: boolean;
}

export interface IsolatedMarginAccount {
  symbol: string;
  position: {
    quantity: string;
    entryPrice: string;
    markPrice: string;
    unrealizedPnL: string;
  };
  margin: string;
  marginRatio: string;
  liquidationPrice: string;
}

export interface CrossMarginAccount {
  totalMargin: string;
  totalPosition: string;
  unrealizedPnL: string;
  marginRatio: string;
  liquidationMargin: string;
}

export interface BorrowRecord {
  id: string;
  currency: string;
  amount: string;
  remainingAmount: string;
  interestRate: string;
  interestAccrued: string;
  borrowTime: number;
}

export interface MarginTradingServiceConfig {
  apiKey: string;
  baseUrl: string;
  maxLeverage?: number;
  riskManagementEnabled?: boolean;
}

export class MarginTradingService {
  private config: MarginTradingServiceConfig;

  constructor(config: MarginTradingServiceConfig) {
    this.config = {
      maxLeverage: 10,
      riskManagementEnabled: true,
      ...config,
    };
  }

  async getMaxBorrowable(currency: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/max-borrowable?currency=${currency}`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    const data = await response.json();
    return data.maxBorrowable;
  }

  async borrow(currency: string, amount: string): Promise<{ success: boolean; borrowId: string }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/borrow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ currency, amount }),
    });
    return response.json();
  }

  async repay(currency: string, amount: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/repay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ currency, amount }),
    });
    return response.json();
  }

  async getBorrowHistory(currency?: string): Promise<BorrowRecord[]> {
    const url = currency
      ? `${this.config.baseUrl}/api/v1/margin/borrows?currency=${currency}`
      : `${this.config.baseUrl}/api/v1/margin/borrows`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async createMarginOrder(order: Omit<MarginOrder, 'id' | 'createdAt' | 'filledQuantity' | 'borrowedAmount' | 'interestRate' | 'status'>): Promise<MarginOrder> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify(order),
    });
    return response.json();
  }

  async getPosition(symbol: string): Promise<MarginPosition> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/position?symbol=${symbol}`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getAllPositions(): Promise<MarginPosition[]> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/positions`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getCrossMarginAccount(): Promise<CrossMarginAccount> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/account`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getIsolatedMarginAccount(symbol: string): Promise<IsolatedMarginAccount> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/isolated/${symbol}`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async adjustLeverage(symbol: string, leverage: number): Promise<{ success: boolean }> {
    if (leverage < 1 || leverage > this.config.maxLeverage!) {
      throw new Error(`Leverage must be between 1 and ${this.config.maxLeverage}`);
    }
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/leverage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ symbol, leverage }),
    });
    return response.json();
  }

  async setAutoAddMargin(symbol: string, enabled: boolean): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/auto-add-margin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ symbol, enabled }),
    });
    return response.json();
  }

  async switchIsolatedMargin(symbol: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/margin/switch-isolated`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ symbol }),
    });
    return response.json();
  }
}

export class RiskCalculator {
  calculateLiquidationPrice(
    positionSide: 'long' | 'short',
    entryPrice: string,
    quantity: string,
    leverage: number,
    marginRatio: number
  ): string {
    const entry = parseFloat(entryPrice);
    const qty = parseFloat(quantity);
    const totalValue = entry * qty;
    const marginBalance = totalValue / leverage;

    if (positionSide === 'long') {
      const liquidationPrice = entry - (marginBalance / qty) * marginRatio;
      return liquidationPrice.toFixed(2);
    } else {
      const liquidationPrice = entry + (marginBalance / qty) * marginRatio;
      return liquidationPrice.toFixed(2);
    }
  }

  calculateMarginRatio(
    positionValue: string,
    isolatedMargin: string,
    unrealizedPnL: string
  ): string {
    const value = parseFloat(positionValue);
    const margin = parseFloat(isolatedMargin);
    const pnl = parseFloat(unrealizedPnL);
    
    const ratio = ((margin + pnl) / value) * 100;
    return ratio.toFixed(2) + '%';
  }

  validateLeverage(leverage: number, maxLeverage: number): boolean {
    return leverage >= 1 && leverage <= maxLeverage;
  }
}