// TigerEx Price Service
// Client-side service for fetching price data

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export interface PriceTick {
  symbol: string;
  price: number;
  change_24h: number;
  change_pct_24h: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  quote_volume: number;
  timestamp: string;
}

export interface OrderBookLevel {
  price: number;
  amount: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  last_update_id: number;
  timestamp: string;
}

export interface TradingPair {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  base_price: number;
  min_price: number;
  max_price: number;
  price_precision: number;
  quantity_precision: number;
  min_quantity: number;
  max_quantity: number;
  volatility: number;
  liquidity_factor: number;
}

class PriceService {
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 1000; // 1 second cache

  private async fetchWithCache<T>(url: string, cacheKey: string): Promise<T> {
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.cacheTTL) {
      return cached.data as T;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    this.cache.set(cacheKey, { data, timestamp: now });
    return data as T;
  }

  async getPrice(symbol: string): Promise<PriceTick | null> {
    try {
      const data = await this.fetchWithCache<any>(
        `${API_BASE_URL}/ticker/price?symbol=${symbol}`,
        `price:${symbol}`
      );
      return data.data || null;
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, error);
      return null;
    }
  }

  async getAllPrices(): Promise<Record<string, PriceTick>> {
    try {
      const data = await this.fetchWithCache<any>(
        `${API_BASE_URL}/ticker/24hr`,
        'all-prices'
      );
      return data.data || {};
    } catch (error) {
      console.error('Error fetching all prices:', error);
      return {};
    }
  }

  async getTicker24h(symbol?: string): Promise<any> {
    try {
      const url = symbol
        ? `${API_BASE_URL}/ticker/24hr?symbol=${symbol}`
        : `${API_BASE_URL}/ticker/24hr`;
      const data = await this.fetchWithCache<any>(url, `ticker:${symbol || 'all'}`);
      return data.data;
    } catch (error) {
      console.error('Error fetching 24h ticker:', error);
      return null;
    }
  }

  async getOrderBook(symbol: string, limit: number = 20): Promise<OrderBook | null> {
    try {
      const data = await this.fetchWithCache<any>(
        `${API_BASE_URL}/orderbook?symbol=${symbol}&limit=${limit}`,
        `orderbook:${symbol}`
      );
      return data.data || null;
    } catch (error) {
      console.error(`Error fetching order book for ${symbol}:`, error);
      return null;
    }
  }

  async getKlines(
    symbol: string,
    interval: string = '1m',
    limit: number = 100
  ): Promise<any[]> {
    try {
      const data = await this.fetchWithCache<any>(
        `${API_BASE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        `klines:${symbol}:${interval}:${limit}`
      );
      return data.data || [];
    } catch (error) {
      console.error(`Error fetching klines for ${symbol}:`, error);
      return [];
    }
  }

  async getDepth(symbol: string, limit: number = 100): Promise<any> {
    try {
      const data = await this.fetchWithCache<any>(
        `${API_BASE_URL}/depth?symbol=${symbol}&limit=${limit}`,
        `depth:${symbol}`
      );
      return data.data;
    } catch (error) {
      console.error(`Error fetching depth for ${symbol}:`, error);
      return null;
    }
  }

  async getMarketSummary(): Promise<any> {
    try {
      const data = await this.fetchWithCache<any>(
        `${API_BASE_URL}/market/summary`,
        'market-summary'
      );
      return data.data;
    } catch (error) {
      console.error('Error fetching market summary:', error);
      return null;
    }
  }

  async getExchangeInfo(): Promise<{ symbols: TradingPair[] }> {
    try {
      const data = await this.fetchWithCache<any>(
        `${API_BASE_URL}/exchangeInfo`,
        'exchange-info'
      );
      return data.data;
    } catch (error) {
      console.error('Error fetching exchange info:', error);
      return { symbols: [] };
    }
  }

  // Format price with precision
  formatPrice(price: number, precision: number = 2): string {
    return price.toFixed(precision);
  }

  // Format volume with abbreviations
  formatVolume(volume: number): string {
    if (volume >= 1e9) {
      return (volume / 1e9).toFixed(2) + 'B';
    }
    if (volume >= 1e6) {
      return (volume / 1e6).toFixed(2) + 'M';
    }
    if (volume >= 1e3) {
      return (volume / 1e3).toFixed(2) + 'K';
    }
    return volume.toFixed(2);
  }

  // Calculate price change color
  getPriceChangeColor(change: number): string {
    if (change > 0) return '#0ecb81'; // green
    if (change < 0) return '#f6465d'; // red
    return '#878787'; // gray
  }

  // Get supported trading pairs
  getSupportedPairs(): string[] {
    return [
      'BTC/USDT',
      'ETH/USDT',
      'BNB/USDT',
      'SOL/USDT',
      'XRP/USDT',
      'ADA/USDT',
      'DOGE/USDT',
      'DOT/USDT',
      'MATIC/USDT',
      'LTC/USDT',
      'AVAX/USDT',
      'LINK/USDT',
      'ATOM/USDT',
      'UNI/USDT',
      'TGR/USDT',
      'RUSD/USDT',
    ];
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const priceService = new PriceService();
export default priceService;
