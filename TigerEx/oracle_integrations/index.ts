/**
 * Oracle Integration Platform
 * 
 * Price feeds from Chainlink, Pyth, Band Protocol
 * Critical for accurate liquidation and settlement
 */

export class OracleIntegrationPlatform {
  private priceFeeds: Map<string, PriceFeed> = new Map();
  private aggregators: Map<string, PriceAggregator> = new Map();

  /**
   * Get latest price from oracle
   */
  async getPrice(symbol: string): Promise<PriceData> {
    const feed = this.priceFeeds.get(symbol);
    if (!feed) throw new Error(`No price feed for ${symbol}`);

    return {
      symbol,
      price: feed.price,
      confidence: feed.confidence,
      timestamp: feed.lastUpdate,
      source: feed.primaryOracle
    };
  }

  /**
   * Add price source (Chainlink, Pyth, etc.)
   */
  async addPriceSource(symbol: string, oracle: string, config: OracleConfig): Promise<void> {
    this.priceFeeds.set(symbol, {
      symbol,
      primaryOracle: oracle,
      price: 0,
      confidence: 0,
      lastUpdate: new Date(),
      updateFrequency: config.updateFrequency || 5000,
      deviationThreshold: config.deviationThreshold || 0.5
    });
  }

  /**
   * Aggregate prices from multiple oracles
   */
  async aggregatePrices(symbol: string): Promise<AggregatedPrice> {
    // Get prices from all sources
    const sources = await Promise.all([
      this.getChainlinkPrice(symbol),
      this.getPythPrice(symbol)
    ]).catch(() => []);

    if (sources.length === 0) throw new Error('No price available');

    // Median aggregation (resistant to outliers)
    const prices = sources.map(s => s.price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    return {
      symbol,
      price: median,
      confidence: Math.min(...sources.map(s => s.confidence)),
      sources: sources.length,
      calculatedAt: new Date()
    };
  }

  private async getChainlinkPrice(symbol: string): Promise<PriceData> {
    // Simulated Chainlink price fetch
    return { symbol, price: 50000, confidence: 0.99, timestamp: new Date(), source: 'chainlink' };
  }

  private async getPythPrice(symbol: string): Promise<PriceData> {
    // Simulated Pyth price fetch  
    return { symbol, price: 50001, confidence: 0.98, timestamp: new Date(), source: 'pyth' };
  }
}

interface PriceFeed {
  symbol: string;
  primaryOracle: string;
  price: number;
  confidence: number;
  lastUpdate: Date;
  updateFrequency: number;
  deviationThreshold: number;
}

interface OracleConfig {
  updateFrequency?: number;
  deviationThreshold?: number;
}

interface PriceData {
  symbol: string;
  price: number;
  confidence: number;
  timestamp: Date;
  source: string;
}

interface AggregatedPrice {
  symbol: string;
  price: number;
  confidence: number;
  sources: number;
  calculatedAt: Date;
}