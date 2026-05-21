/**
 * TigerEx TradFi - Traditional Finance Trading
 * 
 * Trade traditional assets: Stocks, ETFs, Commodities, Forex
 * Similar to Bybit TradFi / Bitget TradFi
 */

export class TigerExTradFi {
  // Available TradFi products
  private products: Map<string, TradFiProduct> = new Map();
  
  // Initialize with default products
  constructor() {
    this.initializeProducts();
  }
  
  private initializeProducts() {
    // Stocks
    this.products.set('AAPL', { symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', exchange: 'NASDAQ' });
    this.products.set('TSLA', { symbol: 'TSLA', name: 'Tesla Inc.', type: 'stock', exchange: 'NASDAQ' });
    this.products.set('NVDA', { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'stock', exchange: 'NASDAQ' });
    this.products.set('GOOGL', { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'stock', exchange: 'NASDAQ' });
    this.products.set('MSFT', { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'stock', exchange: 'NASDAQ' });
    this.products.set('AMZN', { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock', exchange: 'NASDAQ' });
    this.products.set('META', { symbol: 'META', name: 'Meta Platforms', type: 'stock', exchange: 'NASDAQ' });
    
    // ETFs
    this.products.set('SPY', { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'etf', exchange: 'NYSE' });
    this.products.set('QQQ', { symbol: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', exchange: 'NASDAQ' });
    this.products.set('GLD', { symbol: 'GLD', name: 'SPDR Gold Shares', type: 'etf', exchange: 'NYSE' });
    this.products.set('BTC', { symbol: 'BTC', name: 'iShares Bitcoin Trust', type: 'etf', exchange: 'NASDAQ' });
    
    // Commodities
    this.products.set('XAUUSD', { symbol: 'XAUUSD', name: 'Gold / US Dollar', type: 'commodity', exchange: 'FOREX' });
    this.products.set('XAGUSD', { symbol: 'XAGUSD', name: 'Silver / US Dollar', type: 'commodity', exchange: 'FOREX' });
    this.products.set('WTI', { symbol: 'WTI', name: 'Crude Oil WTI', type: 'commodity', exchange: 'NYMEX' });
    this.products.set('NATGAS', { symbol: 'NATGAS', name: 'Natural Gas', type: 'commodity', exchange: 'NYMEX' });
    
    // Forex
    this.products.set('EURUSD', { symbol: 'EURUSD', name: 'Euro / US Dollar', type: 'forex', exchange: 'FOREX' });
    this.products.set('GBPUSD', { symbol: 'GBPUSD', name: 'British Pound / US Dollar', type: 'forex', exchange: 'FOREX' });
    this.products.set('USDJPY', { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', type: 'forex', exchange: 'FOREX' });
    this.products.set('AUDUSD', { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', type: 'forex', exchange: 'FOREX' });
  }
  
  // Get all available products
  async getProducts(type?: string): Promise<TradFiProduct[]> {
    const all = Array.from(this.products.values());
    if (type) return all.filter(p => p.type === type);
    return all;
  }
  
  // Get product by symbol
  async getProduct(symbol: string): Promise<TradFiProduct | undefined> {
    return this.products.get(symbol.toUpperCase());
  }
  
  // Get real-time price
  async getPrice(symbol: string): Promise<TradFiPrice> {
    const product = this.products.get(symbol.toUpperCase());
    if (!product) throw new Error('Product not found');
    
    // Simulated price (in production, connect to real data feeds)
    const basePrice = this.getBasePrice(symbol);
    
    return {
      symbol,
      bid: basePrice * 0.9995,
      ask: basePrice * 1.0005,
      last: basePrice,
      change: (Math.random() - 0.5) * 2,
      changePercent: (Math.random() - 0.5) * 2,
      volume: Math.floor(Math.random() * 1000000),
      timestamp: new Date()
    };
  }
  
  private getBasePrice(symbol: string): number {
    const prices: Record<string, number> = {
      'AAPL': 178.50, 'TSLA': 248.75, 'NVDA': 875.30, 'GOOGL': 141.80,
      'MSFT': 378.90, 'AMZN': 178.25, 'META': 505.75, 'SPY': 502.30,
      'QQQ': 435.60, 'GLD': 185.40, 'BTC': 42.50, 'XAUUSD': 2035.50,
      'XAGUSD': 23.15, 'WTI': 78.45, 'NATGAS': 2.85, 'EURUSD': 1.0875,
      'GBPUSD': 1.2685, 'USDJPY': 148.25, 'AUDUSD': 0.6580
    };
    return prices[symbol] || 100;
  }
  
  // Place TradFi order
  async placeOrder(order: TradFiOrder): Promise<TradFiOrderResult> {
    const product = this.products.get(order.symbol.toUpperCase());
    if (!product) throw new Error('Product not found');
    
    const price = await this.getPrice(order.symbol);
    
    return {
      id: `TFT-${Date.now()}`,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      price: order.type === 'market' ? price.last : order.price,
      status: 'filled',
      filledAt: new Date()
    };
  }
  
  // Get user positions
  async getPositions(userId: string): Promise<TradFiPosition[]> {
    // Simulated positions
    return [
      { symbol: 'AAPL', quantity: 10, entryPrice: 175.00, currentPrice: 178.50, pnl: 35.00 },
      { symbol: 'NVDA', quantity: 5, entryPrice: 850.00, currentPrice: 875.30, pnl: 126.50 },
      { symbol: 'SPY', quantity: 20, entryPrice: 495.00, currentPrice: 502.30, pnl: 146.00 }
    ];
  }
  
  // Calculate margin requirement
  async calculateMargin(symbol: string, quantity: number, leverage: number): Promise<number> {
    const price = await this.getPrice(symbol);
    const positionValue = price.last * quantity;
    return positionValue / leverage;
  }
}

export interface TradFiProduct {
  symbol: string;
  name: string;
  type: 'stock' | 'etf' | 'commodity' | 'forex';
  exchange: string;
}

export interface TradFiPrice {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: Date;
}

export interface TradFiOrder {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  price?: number;
  userId: string;
}

export interface TradFiOrderResult {
  id: string;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  price: number;
  status: string;
  filledAt: Date;
}

export interface TradFiPosition {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}