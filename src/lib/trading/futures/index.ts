/**
 * Futures Trading Module
 * TypeScript implementation for perpetual futures and futures contracts
 */

export interface FuturesContract {
  symbol: string;
  underlying: string;
  contractSize: string;
  expiration?: number;
  contractType: 'perpetual' | 'delivery';
}

export interface FuturesOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  positionSide: 'long' | 'short';
  type: 'market' | 'limit' | 'stop' | 'take_profit';
  price: string;
  quantity: string;
  filledQuantity: string;
  averagePrice: string;
  stopPrice?: string;
  activatePrice?: string;
  status: 'pending' | 'filled' | 'partially_filled' | 'cancelled' | 'expired';
  timeInForce: 'gtc' | 'ioc' | 'fok' | 'buyo' | 'sell';
  reduceOnly: boolean;
  createdAt: number;
}

export interface FuturesPosition {
  symbol: string;
  positionSide: 'long' | 'short';
  quantity: string;
  entryPrice: string;
  markPrice: string;
  unpaidFunding: string;
  unrealizedPnL: string;
  realizedPnL: string;
  leverage: number;
  margin: string;
  liquidationPrice: string;
  bankruptcyPrice: string;
  marginRatio: string;
  autoAddMargin: boolean;
}

export interface FundingInfo {
  symbol: string;
  fundingRate: string;
  nextFundingTime: number;
  predictedFundingRate: string;
  indexPrice: string;
  markPrice: string;
}

export interface UserTrade {
  id: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  positionSide: 'long' | 'short';
  price: string;
  quantity: string;
  fee: string;
  realizedPnL: string;
  role: 'maker' | 'taker';
  timestamp: number;
}

export interface LeverageBracket {
  bracket: number;
  maxLeverage: number;
  minMaintenanceMarginRate: string;
}

export interface FuturesTradingServiceConfig {
  apiKey: string;
  baseUrl: string;
  default Leverage?: number;
}

export class FuturesTradingService {
  private config: FuturesTradingServiceConfig;

  constructor(config: FuturesTradingServiceConfig) {
    this.config = {
      defaultLeverage: 20,
      ...config,
    };
  }

  async createOrder(order: Omit<FuturesOrder, 'id' | 'createdAt' | 'filledQuantity' | 'averagePrice' | 'status'>): Promise<FuturesOrder> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify(order),
    });
    return response.json();
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/orders/${orderId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getOrder(orderId: string): Promise<FuturesOrder> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/orders/${orderId}`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getOpenOrders(symbol?: string): Promise<FuturesOrder[]> {
    const url = symbol
      ? `${this.config.baseUrl}/api/v1/futures/orders?status=open&symbol=${symbol}`
      : `${this.config.baseUrl}/api/v1/futures/orders?status=open`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getPosition(symbol: string): Promise<FuturesPosition> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/position?symbol=${symbol}`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getAllPositions(): Promise<FuturesPosition[]> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/positions`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getFundingRates(symbols?: string[]): Promise<FundingInfo[]> {
    const symbolsParam = symbols?.join(',');
    const url = symbolsParam
      ? `${this.config.baseUrl}/api/v1/futures/funding?symbols=${symbolsParam}`
      : `${this.config.baseUrl}/api/v1/futures/funding`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getUserTrades(symbol?: string, limit = 50): Promise<UserTrade[]> {
    const url = symbol
      ? `${this.config.baseUrl}/api/v1/futures/trades?symbol=${symbol}&limit=${limit}`
      : `${this.config.baseUrl}/api/v1/futures/trades?limit=${limit}`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getContracts(): Promise<FuturesContract[]> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/contracts`);
    return response.json();
  }

  async setLeverage(symbol: string, leverage: number, positionSide?: 'long' | 'short'): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/leverage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ symbol, leverage, positionSide }),
    });
    return response.json();
  }

  async setMarginMode(symbol: string, mode: 'cross' | 'isolated', positionSide?: 'long' | 'short'): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/margin-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ symbol, mode, positionSide }),
    });
    return response.json();
  }

  async addMargin(symbol: string, amount: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/add-margin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ symbol, amount }),
    });
    return response.json();
  }

  async getLeverageBrackets(symbol: string): Promise<LeverageBracket[]> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/leverage-bracket?symbol=${symbol}`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }

  async getAccountBalance(): Promise<{ totalBalance: string; availableBalance: string; totalUnrealizedPnL: string }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/futures/account-balance`, {
      headers: { 'X-API-Key': this.config.apiKey },
    });
    return response.json();
  }
}

export class FuturesPriceCalculator {
  calculateMarkPrice(
    indexPrice: string,
    lastFundingRate: string,
    timeUntilFunding: number
  ): string {
    const index = parseFloat(indexPrice);
    const funding = parseFloat(lastFundingRate);
    const timeFraction = timeUntilFunding / (8 * 3600); // 8 hours
    
    const markPrice = index * (1 + funding * timeFraction);
    return markPrice.toFixed(2);
  }

  calculateFundingRate(
    premiumIndex: string,
    interestRate: string,
    clampedPremiumRate: number
  ): string {
    const premium = parseFloat(premiumIndex);
    const interest = parseFloat(interestRate);
    
    let rate = premium + interest;
    rate = Math.max(Math.min(clampedPremiumRate, rate), -clampedPremiumRate);
    
    return rate.toFixed(6);
  }

  calculatePnL(
    side: 'long' | 'short',
    entryPrice: string,
    currentPrice: string,
    quantity: string
  ): string {
    const entry = parseFloat(entryPrice);
    const current = parseFloat(currentPrice);
    const qty = parseFloat(quantity);
    
    let pnl: number;
    if (side === 'long') {
      pnl = (current - entry) * qty;
    } else {
      pnl = (entry - current) * qty;
    }
    
    return pnl.toFixed(2);
  }

  calculateLiquidationPrice(
    positionSide: 'long' | 'short',
    entryPrice: string,
    quantity: string,
    leverage: number,
    maintenanceMarginRate: number
  ): string {
    const entry = parseFloat(entryPrice);
    const qty = parseFloat(quantity);
    const positionValue = entry * qty;
    const margin = positionValue / leverage;
    const maintenanceMargin = positionValue * maintenanceMarginRate;
    
    let liqPrice: number;
    if (positionSide === 'long') {
      liqPrice = entry - (margin - maintenanceMargin) / qty;
    } else {
      liqPrice = entry + (margin - maintenanceMargin) / qty;
    }
    
    return liqPrice.toFixed(2);
  }
}