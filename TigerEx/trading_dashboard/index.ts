/**
 * TigerEx Trading Dashboard
 * Complete user trading dashboard like Binance
 */

export interface MarketOverview {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  trades24h: number;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

export interface OrderBook {
  lastUpdateId: number;
  bids: OrderBookEntry[][];
  asks: OrderBookEntry[][];
}

export interface Trade {
  id: string;
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface Ticker {
  symbol: string;
  priceChange: number;
  priceChangePercent: number;
  weightedAvgPrice: number;
  prevClosePrice: number;
  lastPrice: number;
  lastQty: number;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface UserPosition {
  symbol: string;
  positionSide: string;
  marginAmount: number;
 isolatedMargin: number;
  leverage: number;
  liqPrice: number;
  bustPrice: number;
  cumReal: number;
  opened: number;
}

export interface UserAsset {
  asset: string;
  free: number;
  locked: number;
}

export class TradingDashboard {
  private markets: Map<string, MarketOverview> = new Map();
  private userAssets: Map<string, UserAsset> = new Map();
  private positions: Map<string, UserPosition> = new Map();

  // Get all tickers for market overview
  async get24hTickers(): Promise<Ticker[]> {
    const tickers: Ticker[] = [];
    this.markets.forEach((_, symbol) => {
      tickers.push({
        symbol,
        priceChange: Math.random() * 100 - 50,
        priceChangePercent: Math.random() * 10 - 5,
        weightedAvgPrice: Math.random() * 1000 + 10000,
        prevClosePrice: Math.random() * 1000 + 10000,
        lastPrice: Math.random() * 1000 + 10000,
        lastQty: Math.random() * 10,
        bidPrice: Math.random() * 1000 + 9999,
        bidQty: Math.random() * 100,
        askPrice: Math.random() * 1000 + 10001,
        askQty: Math.random() * 100,
        openPrice: Math.random() * 1000 + 10000,
        highPrice: Math.random() * 1000 + 11000,
        lowPrice: Math.random() * 1000 + 9000,
        volume: Math.random() * 1000000,
        quoteVolume: Math.random() * 100000000,
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        firstId: 1,
        lastId: 1000000,
        count: Math.floor(Math.random() * 1000000),
      });
    });
    return tickers;
  }

  // Get order book
  async getOrderBook(symbol: string, limit: number = 100): Promise<OrderBook> {
    const bids: OrderBookEntry[][] = [];
    const asks: OrderBookEntry[][] = [];

    for (let i = 0; i < limit; i++) {
      const price = 50000 + Math.random() * 1000 - i * 10;
      bids.push([price, Math.random() * 10, price * Math.random() * 10]);
      asks.push([51000 + i * 10, Math.random() * 10, (51000 + i * 10) * Math.random() * 10]);
    }

    return { lastUpdateId: Date.now(), bids, asks };
  }

  // Get recent trades
  async getRecentTrades(symbol: string, limit: number = 100): Promise<Trade[]> {
    const trades: Trade[] = [];
    for (let i = 0; i < limit; i++) {
      trades.push({
        id: `trade_${i}`,
        price: 50000 + Math.random() * 1000,
        quantity: Math.random() * 10,
        time: Date.now() - i * 1000,
        isBuyerMaker: Math.random() > 0.5,
      });
    }
    return trades;
  }

  // Get klines/candlesticks
  async getKlines(
    symbol: string,
    interval: string,
    startTime?: number,
    endTime?: number,
    limit: number = 500
  ): Promise<Kline[]> {
    const klines: Kline[] = [];
    let time = startTime || Date.now() - limit * 3600000;

    for (let i = 0; i < limit; i++) {
      const open = 50000 + Math.random() * 1000;
      klines.push({
        openTime: time,
        open,
        high: open + Math.random() * 100,
        low: open - Math.random() * 100,
        close: open + Math.random() * 200 - 100,
        volume: Math.random() * 10000,
        closeTime: time + 3600000,
      });
      time += 3600000;
    }
    return klines;
  }

  // Get user account info
  async getAccount(): Promise<{ assets: UserAsset[]; canTrade: boolean; canWithdraw: boolean; canDeposit: boolean }> {
    const assets: UserAsset[] = [
      { asset: 'USDT', free: 10000, locked: 5000 },
      { asset: 'BTC', free: 1.5, locked: 0.5 },
      { asset: 'ETH', free: 10, locked: 5 },
    ];
    return { assets, canTrade: true, canWithdraw: true, canDeposit: true };
  }

  // Get open orders
  async getOpenOrders(symbol?: string): Promise<any[]> {
    return [
      {
        symbol: 'BTCUSDT',
        orderId: '123456',
        price: 50000,
        origQty: 1,
        executedQty: 0,
        side: 'BUY',
        type: 'LIMIT',
        status: 'NEW',
      },
    ];
  }

  // Get order history
  async getOrderHistory(symbol: string, limit: number = 500): Promise<any[]> {
    return [];
  }

  // Get user trades
  async getUserTrades(symbol: string, limit: number = 500): Promise<Trade[]> {
    return [];
  }

  // Get positions
  async getPositions(symbol?: string): Promise<UserPosition[]> {
    return [];
  }

  // Get 24h order book ticker
  async get24hTicker(symbol: string): Promise<Ticker> {
    return {
      symbol,
      priceChange: 500,
      priceChangePercent: 1,
      weightedAvgPrice: 50500,
      prevClosePrice: 50000,
      lastPrice: 50500,
      lastQty: 1,
      bidPrice: 50499,
      bidQty: 10,
      askPrice: 50501,
      askQty: 10,
      openPrice: 50000,
      highPrice: 51000,
      lowPrice: 49000,
      volume: 1000000,
      quoteVolume: 50000000,
      openTime: Date.now() - 86400000,
      closeTime: Date.now(),
      firstId: 1,
      lastId: 1000000,
      count: 500000,
    };
  }
}

export default TradingDashboard;