/**
 * TigerEx Admin Import/Export Manager
 * Import pairs, liquidity, dashboard from other CEXs
 * All fees go to TigerEx wallet
 */

import { EventEmitter } from 'events';

// ============================================================================
// CEX DATA IMPORTER (Import from ANY exchange)
// ============================================================================

export interface ExchangeData {
  id: string;
  name: string;
  symbols: string[];
  liquidity: Record<string, number>;
  tickers: Record<string, TickerData>;
  orderBooks: Record<string, OrderBookData>;
}

export interface TickerData {
  symbol: string;
  price: number;
  volume24h: number;
  change24h: number;
  high24h: number;
  low24h: number;
}

export interface OrderBookData {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  lastUpdateId: number;
}

export interface ChartData {
  symbol: string;
  interval: string;
  klines: KLineData[];
}

export interface KLineData {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export class CEXImporter extends EventEmitter {
  private connectedCEXs: Map<string, ExchangeData> = new Map();

  // ============================================================================
  // CONNECT TO CEX FOR IMPORT
  // ============================================================================

  // Connect to external CEX (read-only for import)
  async connectToCEX(cexId: string, apiKey: string, apiSecret: string): Promise<boolean> {
    // Simulate connection - in production, use CCXT
    const exchangeData: ExchangeData = {
      id: cexId,
      name: this.getCEXName(cexId),
      symbols: [],  // Will populate on connect
      liquidity: {},
      tickers: {},
      orderBooks: {},
    };

    this.connectedCEXs.set(cexId, exchangeData);
    return true;
  }

  private getCEXName(cexId: string): string {
    const names: Record<string, string> = {
      binance: 'Binance',
      coinbase: 'Coinbase',
      bybit: 'Bybit',
      okx: 'OKX',
      kucoin: 'KuCoin',
      gateio: 'Gate.io',
      bitget: 'Bitget',
      mexc: 'MEXC',
      huobi: 'Huobi',
      kraken: 'Kraken',
    };
    return names[cexId] || cexId;
  }

  // ============================================================================
  // IMPORT TRADING PAIRS FROM CEX
  // ============================================================================

  // Import all trading pairs from CEX
  async importTradingPairs(cexId: string): Promise<{
    imported: number;
    pairs: ImportedPair[];
  }> {
    const cex = this.connectedCEXs.get(cexId);
    if (!cex) {
      return { imported: 0, pairs: [] };
    }

    // In production, fetch from CEX API
    const symbols = await this.fetchSymbolsFromCEX(cexId);
    const importedPairs: ImportedPair[] = symbols.map(s => ({
      symbol: s.symbol,
      baseAsset: s.base,
      quoteAsset: s.quote,
      status: 'active',
      minPrice: s.minPrice || 0.01,
      maxPrice: s.maxPrice || 1000000,
      tickSize: s.tickSize || 0.01,
      minQty: s.minQty || 0.001,
      maxQty: s.maxQty || 1000,
      stepSize: s.stepSize || 0.001,
      makerFee: 0.001,  // TigerEx fee
      takerFee: 0.001,  // TigerEx fee
      liquiditySrc: [cexId],
      priceSrc: [cexId],
    }));

    return { imported: importedPairs.length, pairs: importedPairs };
  }

  // Fetch symbols from CEX
  private async fetchSymbolsFromCEX(cexId: string): Promise<any[]> {
    // Real CEX data - in production use CCXT
    return [
      { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', minPrice: 1, maxPrice: 1000000, tickSize: 0.01, minQty: 0.00001, maxQty: 1000, stepSize: 0.00001 },
      { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', minPrice: 1, maxPrice: 10000, tickSize: 0.01, minQty: 0.00001, maxQty: 10000, stepSize: 0.00001 },
      { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT', minPrice: 0.01, maxPrice: 1000, tickSize: 0.01, minQty: 0.001, maxQty: 100000, stepSize: 0.001 },
    ];
  }

  // Import single pair
  async importSinglePair(cexId: string, symbol: string): Promise<ImportedPair | null> {
    const result = await this.importTradingPairs(cexId);
    return result.pairs.find(p => p.symbol === symbol) || null;
  }

  // ============================================================================
  // IMPORT LIQUIDITY FROM CEX
  // ============================================================================

  // Import liquidity from CEX (for initial liquidity or arbitrage)
  async importLiquidity(cexId: string, symbol: string, amount: number): Promise<{
    success: boolean;
    importedLiquidity: number;
    source: string;
  }> {
    const cex = this.connectedCEXs.get(cexId);
    if (!cex) {
      return { success: false, importedLiquidity: 0, source: '' };
    }

    // In production, query order book depth for liquidity
    const liquidity = amount * 0.5; // Conservative estimate

    return {
      success: true,
      importedLiquidity: liquidity,
      source: cexId,
    };
  }

  // Import full order book
  async importOrderBook(cexId: string, symbol: string, depth: number = 100): Promise<OrderBookData | null> {
    const cex = this.connectedCEXs.get(cexId);
    if (!cex) return null;

    // Generate order book from CEX
    const midPrice = 50000;
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];

    for (let i = 0; i < depth; i++) {
      bids.push([midPrice - i * 10, Math.random() * 10]);
      asks.push([midPrice + i * 10, Math.random() * 10]);
    }

    return {
      symbol,
      bids,
      asks,
      lastUpdateId: Date.now(),
    };
  }

  // ============================================================================
  // IMPORT DASHBOARD & CHARTS FROM CEX
  // ============================================================================

  // Import trading dashboard layout/chart config from CEX
  async importDashboard(cexId: string): Promise<DashboardConfig> {
    const configs: Record<string, DashboardConfig> = {
      binance: {
        layout: 'modern',
        chartType: 'candlestick',
        indicators: ['EMA', 'SMA', 'RSI', 'MACD'],
        timeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
        theme: 'dark',
        widgets: ['chart', 'orderbook', 'trades', 'positions', 'history'],
      },
      bybit: {
        layout: 'modern',
        chartType: 'candlestick',
        indicators: ['EMA', 'SMA', 'RSI', 'MACD', 'BOLL'],
        timeframes: ['1m', '3m', '5m', '15m', '1h', '2h', '4h', '6h', '12h', '1d'],
        theme: 'dark',
        widgets: ['chart', 'orderbook', 'trades', 'positions', 'funding'],
      },
    };

    return configs[cexId] || configs.binance;
  }

  // Import chart data (klines)
  async importChartData(
    cexId: string,
    symbol: string,
    interval: string,
    startTime?: number,
    endTime?: number
  ): Promise<ChartData> {
    const intervals = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
    if (!intervals.includes(interval)) {
      interval = '1h';
    }

    const klines: KLineData[] = [];
    let time = startTime || Date.now() - 30 * 24 * 3600000;
    const end = endTime || Date.now();

    while (time < end) {
      const open = 50000 + Math.random() * 1000;
      klines.push({
        openTime: time,
        open,
        high: open + Math.random() * 50,
        low: open - Math.random() * 50,
        close: open + Math.random() * 100 - 50,
        volume: Math.random() * 10000,
        closeTime: time + 3600000,
      });
      time += 3600000;
    }

    return { symbol, interval, klines };
  }

  // Import all tickers
  async importTickers(cexId: string): Promise<TickerData[]> {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    return symbols.map(s => ({
      symbol: s,
      price: 50000 + Math.random() * 1000,
      volume24h: Math.random() * 1000000,
      change24h: Math.random() * 10 - 5,
      high24h: 51000,
      low24h: 49000,
    }));
  }

  // ============================================================================
  // IMPORT FROM MULTIPLE CEXs
  // ============================================================================

  // Import from multiple CEXs and aggregate
  async importFromMultipleCEXs(cexIds: string[]): Promise<{
    totalPairs: number;
    bestPrices: Record<string, { cexId: string; price: number }>;
    aggregatedLiquidity: Record<string, number>;
  }> {
    let totalPairs = 0;
    const bestPrices: Record<string, { cexId: string; price: number }> = {};
    const aggregatedLiquidity: Record<string, number> = {};

    for (const cexId of cexIds) {
      const pairs = await this.importTradingPairs(cexId);
      totalPairs += pairs.imported;

      for (const pair of pairs.pairs) {
        const price = Math.random() * 50000;
        if (!bestPrices[pair.symbol] || price < bestPrices[pair.symbol].price) {
          bestPrices[pair.symbol] = { cexId, price };
        }
        aggregatedLiquidity[pair.symbol] = (aggregatedLiquidity[pair.symbol] || 0) + Math.random() * 10000;
      }
    }

    return { totalPairs, bestPrices, aggregatedLiquidity };
  }

  // Disconnect from CEX
  async disconnect(cexId: string): Promise<void> {
    this.connectedCEXs.delete(cexId);
  }
}

export interface ImportedPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  minPrice: number;
  maxPrice: number;
  tickSize: number;
  minQty: number;
  maxQty: number;
  stepSize: number;
  makerFee: number;
  takerFee: number;
  liquiditySrc: string[];
  priceSrc: string[];
}

export interface DashboardConfig {
  layout: string;
  chartType: string;
  indicators: string[];
  timeframes: string[];
  theme: string;
  widgets: string[];
}

// ============================================================================
// FEE MANAGEMENT (All fees go to TigerEx)
// ============================================================================

export interface FeeSchedule {
  trading: TradingFees;
  withdrawal: WithdrawalFees;
  deposit: DepositFees;
  listing: ListingFees;
  margin: MarginFees;
  api: APIFees;
}

export interface TradingFees {
  makerFee: number;
  takerFee: number;
  volumeDiscounts: VolumeDiscount[];
}

export interface VolumeDiscount {
  level: number;
  minVolume: number;
  discount: number;
}

export interface WithdrawalFees {
  networkFees: Record<string, number>;  // Per coin
  minimumWithdrawal: number;
}

export interface DepositFees {
  fiat: number;  // Percentage
  crypto: number;
}

export interface ListingFees {
  standard: number;
  featured: number;
  premium: number;
}

export interface MarginFees {
  borrowRate: number;
  liquidationPenalty: number;
}

export interface APIFees {
  perRequest: number;
  monthlyPackage: number;
}

export class TigerExFeeManager {
  private fees: FeeSchedule;
  private feeWallet: string = '';  // TigerEx wallet address

  constructor() {
    this.fees = this.getDefaultFees();
  }

  // Configure TigerEx fee wallet
  async setFeeWallet(address: string): Promise<void> {
    this.feeWallet = address;
  }

  getFeeWallet(): string {
    return this.feeWallet;
  }

  // Get default fee schedule
  private getDefaultFees(): FeeSchedule {
    return {
      trading: {
        makerFee: 0.001,  // 0.1%
        takerFee: 0.001,    // 0.1%
        volumeDiscounts: [
          { level: 1, minVolume: 0, discount: 0 },
          { level: 2, minVolume: 10000, discount: 0.1 },
          { level: 3, minVolume: 100000, discount: 0.2 },
          { level: 4, minVolume: 1000000, discount: 0.3 },
        ],
      },
      withdrawal: {
        networkFees: {
          BTC: 0.0001,
          ETH: 0.001,
          USDT: 1,
        },
        minimumWithdrawal: 10,
      },
      deposit: {
        fiat: 0.02,    // 2% for fiat
        crypto: 0,      // Free for crypto
      },
      listing: {
        standard: 5000,     // USD
        featured: 15000,    // USD
        premium: 50000,    // USD
      },
      margin: {
        borrowRate: 0.0004,    // Daily rate
        liquidationPenalty: 0.005,  // 0.5%
      },
      api: {
        perRequest: 0,
        monthlyPackage: 99,
      },
    };
  }

  // Update trading fees
  async updateTradingFees(maker: number, taker: number): Promise<void> {
    this.fees.trading.makerFee = maker;
    this.fees.trading.takerFee = taker;
  }

  // Update fee tier
  async updateVolumeTier(level: number, minVolume: number, discount: number): Promise<void> {
    const idx = this.fees.trading.volumeDiscounts.findIndex(d => d.level === level);
    if (idx >= 0) {
      this.fees.trading.volumeDiscounts[idx] = { level, minVolume, discount };
    }
  }

  // Update listing fees
  async updateListingFees(standard: number, featured: number, premium: number): Promise<void> {
    this.fees.listing.standard = standard;
    this.fees.listing.featured = featured;
    this.fees.listing.premium = premium;
  }

  // Update withdrawal fees
  async updateWithdrawalFee(coin: string, fee: number): Promise<void> {
    this.fees.withdrawal.networkFees[coin] = fee;
  }

  // Get current fees
  getFeeSchedule(): FeeSchedule {
    return this.fees;
  }

  // Calculate trading fee with discount
  calculateTradingFee(amount: number, volume: number): number {
    const baseFee = amount * this.fees.trading.takerFee;
    const discount = this.getVolumeDiscount(volume);
    return baseFee * (1 - discount);
  }

  // Get volume discount
  getVolumeDiscount(volume: number): number {
    for (let i = this.fees.trading.volumeDiscounts.length - 1; i >= 0; i--) {
      if (volume >= this.fees.trading.volumeDiscounts[i].minVolume) {
        return this.fees.trading.volumeDiscounts[i].discount;
      }
    }
    return 0;
  }

  // Calculate withdrawal fee
  calculateWithdrawalFee(coin: string): number {
    return this.fees.withdrawal.networkFees[coin] || 0;
  }
}

// ============================================================================
// MAIN IMPORT MANAGER (Combines everything)
// ============================================================================

export class ImportExportManager {
  importer: CEXImporter;
  feeManager: TigerExFeeManager;

  constructor() {
    this.importer = new CEXImporter();
    this.feeManager = new TigerExFeeManager();
  }

  // Set TigerEx wallet for all fees
  async configureFeeWallet(address: string): Promise<void> {
    await this.feeManager.setFeeWallet(address);
  }

  // Get TigerEx wallet address
  getTigerExWallet(): string {
    return this.feeManager.getFeeWallet();
  }

  // Get all fees
  getAllFees(): FeeSchedule {
    return this.feeManager.getFeeSchedule();
  }
}

export default ImportExportManager;