/**
 * Spot Trading Module
 * TypeScript implementation for spot trading features
 */

export interface SpotOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_limit';
  price: string;
  quantity: string;
  filledQuantity: string;
  averagePrice: string;
  status: 'pending' | 'filled' | 'partially_filled' | 'cancelled';
  timeInForce: 'gtc' | 'ioc' | 'fok';
  createdAt: number;
  updatedAt: number;
}

export interface SpotTrade {
  id: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: string;
  quantity: string;
  fee: string;
  feeCurrency: string;
  role: 'maker' | 'taker';
  timestamp: number;
}

export interface SpotMarket {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: 'trading' | 'break';
  precision: number;
  minQuantity: string;
  maxQuantity: string;
  minNotional: string;
  stepSize: string;
  tickSize: string;
  makerFee: string;
  takerFee: string;
}

export interface Ticker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume24h: string;
  quoteVolume24h: string;
  trades24h: number;
}

export interface OrderBook {
  symbol: string;
  bids: [string, string][];
  asks: [string, string][];
  lastUpdateId: number;
}

export class SpotTradingService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.tigerex.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async createOrder(order: Omit<SpotOrder, 'id' | 'createdAt' | 'updatedAt' | 'averagePrice' | 'filledQuantity' | 'status'>): Promise<SpotOrder> {
    const response = await fetch(`${this.baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(order),
    });
    return response.json();
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/v1/orders/${orderId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getOrder(orderId: string): Promise<SpotOrder> {
    const response = await fetch(`${this.baseUrl}/api/v1/orders/${orderId}`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getOpenOrders(symbol?: string): Promise<SpotOrder[]> {
    const url = symbol 
      ? `${this.baseUrl}/api/v1/orders?symbol=${symbol}&status=open`
      : `${this.baseUrl}/api/v1/orders?status=open`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getTrades(symbol?: string, limit = 50): Promise<SpotTrade[]> {
    const url = symbol
      ? `${this.baseUrl}/api/v1/trades?symbol=${symbol}&limit=${limit}`
      : `${this.baseUrl}/api/v1/trades?limit=${limit}`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return response.json();
  }

  async getMarkets(): Promise<SpotMarket[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/markets`);
    return response.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const response = await fetch(`${this.baseUrl}/api/v1/markets/${symbol}/ticker`);
    return response.json();
  }

  async getOrderBook(symbol: string, limit = 20): Promise<OrderBook> {
    const response = await fetch(`${this.baseUrl}/api/v1/markets/${symbol}/orderbook?limit=${limit}`);
    return response.json();
  }
}

export class OrderBookService {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Set<(ob: OrderBook) => void>> = new Map();

  connect(streamUrl: string): void {
    this.ws = new WebSocket(streamUrl);
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'orderbook') {
        this.notifySubscribers(data.symbol, data);
      }
    };
  }

  subscribe(symbol: string, callback: (ob: OrderBook) => void): void {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }
    this.subscribers.get(symbol)!.add(callback);
    this.ws?.send(JSON.stringify({ action: 'subscribe', symbol }));
  }

  unsubscribe(symbol: string, callback: (ob: OrderBook) => void): void {
    this.subscribers.get(symbol)?.delete(callback);
    this.ws?.send(JSON.stringify({ action: 'unsubscribe', symbol }));
  }

  private notifySubscribers(symbol: string, ob: OrderBook): void {
    this.subscribers.get(symbol)?.forEach(cb => cb(ob));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}