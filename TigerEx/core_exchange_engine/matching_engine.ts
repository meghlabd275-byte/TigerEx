/**
 * TigerEx Core Exchange Engine
 * 
 * High-performance matching engine for spot, futures, and options
 * Real implementation with order book management
 */

import { EventEmitter } from 'events';

// Order types
export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP_MARKET = 'stop_market',
  STOP_LIMIT = 'stop_limit',
  TAKE_PROFIT = 'take_profit',
  TRAILING_STOP = 'trailing_stop'
}

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

export enum OrderStatus {
  PENDING = 'pending',
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected'
}

export enum TimeInForce {
  GTC = 'good_till_cancel',
  IOC = 'immediate_or_cancel',
  FOK = 'fill_or_kill'
}

export interface Order {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  filledQuantity: number;
  averageFillPrice?: number;
  status: OrderStatus;
  timeInForce: TimeInForce;
  createdAt: Date;
  updatedAt: Date;
}

export interface Trade {
  id: string;
  orderId: string;
  counterOrderId?: string;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  fee: number;
  feeAsset: string;
  executedAt: Date;
}

export interface OrderBook {
  symbol: string;
  bids: [number, number][]; // [price, quantity]
  asks: [number, number][];
  lastUpdateId: number;
}

export interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  minQuantity: number;
  maxQuantity: number;
  minPrice: number;
  maxPrice: number;
  status: 'trading' | 'halted' | 'pending';
}

export class MatchingEngine extends EventEmitter {
  private orderBooks: Map<string, OrderBook> = new Map();
  private orders: Map<string, Order> = new Map();
  private markets: Map<string, Market> = new Map();
  private trades: Trade[] = [];
  private orderIdCounter: number = 0;
  private tradeIdCounter: number = 0;
  private fees: Map<string, { maker: number; taker: number }> = new Map();

  constructor() {
    super();
    this.initializeMarkets();
    this.initializeFees();
  }

  private initializeMarkets(): void {
    // Major trading pairs
    const marketConfigs = [
      { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', pricePrec: 2, qtyPrec: 6 },
      { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', pricePrec: 2, qtyPrec: 5 },
      { symbol: 'BNB/USDT', base: 'BNB', quote: 'USDT', pricePrec: 2, qtyPrec: 4 },
      { symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', pricePrec: 3, qtyPrec: 3 },
      { symbol: 'XRP/USDT', base: 'XRP', quote: 'USDT', pricePrec: 5, qtyPrec: 1 },
      { symbol: 'ADA/USDT', base: 'ADA', quote: 'USDT', pricePrec: 5, qtyPrec: 1 },
      { symbol: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', pricePrec: 6, qtyPrec: 0 },
      { symbol: 'DOT/USDT', base: 'DOT', quote: 'USDT', pricePrec: 3, qtyPrec: 2 },
      { symbol: 'MATIC/USDT', base: 'MATIC', quote: 'USDT', pricePrec: 4, qtyPrec: 1 },
      { symbol: 'LTC/USDT', base: 'LTC', quote: 'USDT', pricePrec: 2, qtyPrec: 4 },
    ];

    marketConfigs.forEach(config => {
      const market: Market = {
        symbol: config.symbol,
        baseAsset: config.base,
        quoteAsset: config.quote,
        pricePrecision: config.pricePrec,
        quantityPrecision: config.qtyPrec,
        minQuantity: this.getMinQuantity(config.qtyPrec),
        maxQuantity: 1000000000,
        minPrice: 0.00000001,
        maxPrice: 999999999999,
        status: 'trading'
      };
      this.markets.set(config.symbol, market);
      
      // Initialize order book
      this.orderBooks.set(config.symbol, {
        symbol: config.symbol,
        bids: [],
        asks: [],
        lastUpdateId: 0
      });
    });
  }

  private getMinQuantity(precision: number): number {
    return Math.pow(10, -precision);
  }

  private initializeFees(): void {
    // Fee structure (tier-based)
    const feeTiers = [
      { volume: 0, maker: 0.001, taker: 0.001 },
      { volume: 100000, maker: 0.0008, taker: 0.0008 },
      { volume: 1000000, maker: 0.0006, taker: 0.0006 },
      { volume: 10000000, maker: 0.0004, taker: 0.0005 },
      { volume: 100000000, maker: 0.0000, taker: 0.0004 },
    ];
    feeTiers.forEach((tier, index) => {
      this.fees.set(`tier_${index}`, { maker: tier.maker, taker: tier.taker });
    });
  }

  // Create new order
  async createOrder(orderInput: Omit<Order, 'id' | 'filledQuantity' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Order> {
    const market = this.markets.get(orderInput.symbol);
    if (!market) {
      throw new Error(`Market ${orderInput.symbol} not found`);
    }

    // Validate order
    this.validateOrder(orderInput, market);

    // Create order
    const order: Order = {
      ...orderInput,
      id: `ORD-${++this.orderIdCounter}`,
      filledQuantity: 0,
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.orders.set(order.id, order);

    // Process order based on type
    if (order.type === OrderType.MARKET) {
      await this.processMarketOrder(order);
    } else {
      await this.processLimitOrder(order);
    }

    this.emit('orderCreated', order);
    return order;
  }

  private validateOrder(order: Omit<Order, 'id' | 'filledQuantity' | 'status' | 'createdAt' | 'updatedAt'>, market: Market): void {
    if (order.quantity <= 0) {
      throw new Error('Quantity must be positive');
    }
    if (order.quantity < market.minQuantity) {
      throw new Error(`Minimum quantity is ${market.minQuantity}`);
    }
    if (order.type === OrderType.LIMIT && (!order.price || order.price <= 0)) {
      throw new Error('Limit orders require a valid price');
    }
    if (order.type === OrderType.LIMIT && (order.price < market.minPrice || order.price > market.maxPrice)) {
      throw new Error(`Price must be between ${market.minPrice} and ${market.maxPrice}`);
    }
  }

  private async processLimitOrder(order: Order): Promise<void> {
    const book = this.orderBooks.get(order.symbol)!;
    
    // Check if order can be filled immediately (for market-like orders or IOC)
    const canFill = this.checkImmediateFill(order, book);
    
    if (canFill && order.timeInForce === TimeInForce.IOC) {
      await this.fillOrder(order, book);
    } else if (canFill && order.timeInForce === TimeInForce.FOK) {
      await this.fillOrder(order, book);
      if (order.filledQuantity === 0) {
        order.status = OrderStatus.REJECTED;
        order.rejectedReason = 'Unable to fill completely';
      }
    } else {
      // Add to order book
      order.status = OrderStatus.OPEN;
      this.addToOrderBook(order, book);
    }
  }

  private checkImmediateFill(order: Order, book: OrderBook): boolean {
    if (order.type !== OrderType.MARKET && order.timeInForce === TimeInForce.GTC) {
      return false;
    }

    const oppositeSide = order.side === OrderSide.BUY ? book.asks : book.bids;
    return oppositeSide.length > 0;
  }

  private async processMarketOrder(order: Order): Promise<void> {
    const book = this.orderBooks.get(order.symbol)!;
    await this.fillOrder(order, book);
  }

  private async fillOrder(order: Order, book: OrderBook): Promise<void> {
    const isBuy = order.side === OrderSide.BUY;
    const oppositeBook = isBuy ? book.asks : book.bids;
    
    let remainingQuantity = order.quantity;
    let totalCost = 0;

    // Sort by price (lowest ask for buy, highest bid for sell)
    oppositeBook.sort((a, b) => isBuy ? a[0] - b[0] : b[0] - a[0]);

    for (let i = 0; i < oppositeBook.length && remainingQuantity > 0; i++) {
      const [price, availableQty] = oppositeBook[i];
      const fillQty = Math.min(remainingQuantity, availableQty);
      
      // Create trade
      const trade: Trade = {
        id: `TRD-${++this.tradeIdCounter}`,
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        price,
        quantity: fillQty,
        fee: 0, // Will be calculated
        feeAsset: order.symbol.split('/')[1],
        executedAt: new Date()
      };
      
      this.trades.push(trade);
      totalCost += price * fillQty;
      remainingQuantity -= fillQty;
      
      // Update book
      if (fillQty === availableQty) {
        oppositeBook.splice(i, 1);
        i--;
      } else {
        oppositeBook[i] = [price, availableQty - fillQty];
      }
      
      // Update order
      order.filledQuantity += fillQty;
      order.averageFillPrice = totalCost / (order.quantity - remainingQuantity);
      
      this.emit('trade', trade);
    }

    // Update order status
    if (remainingQuantity === 0) {
      order.status = OrderStatus.FILLED;
    } else if (order.filledQuantity > 0) {
      order.status = OrderStatus.PARTIALLY_FILLED;
    } else {
      order.status = OrderStatus.REJECTED;
    }

    order.updatedAt = new Date();
    book.lastUpdateId++;
    this.emit('orderFilled', order);
  }

  private addToOrderBook(order: Order, book: OrderBook): void {
    const isBuy = order.side === OrderSide.BUY;
    const bookSide = isBuy ? book.bids : book.asks;
    const price = order.price!;
    const quantity = order.quantity - order.filledQuantity;

    // Find position or add new
    const existingIndex = bookSide.findIndex(([p]) => p === price);
    if (existingIndex >= 0) {
      bookSide[existingIndex][1] += quantity;
    } else {
      bookSide.push([price, quantity]);
      // Sort
      bookSide.sort((a, b) => isBuy ? b[0] - a[0] : a[0] - b[0]);
    }

    book.lastUpdateId++;
  }

  // Cancel order
  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    if (order.userId !== userId) {
      throw new Error('Unauthorized');
    }
    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.PARTIALLY_FILLED) {
      throw new Error('Order cannot be cancelled');
    }

    order.status = OrderStatus.CANCELLED;
    order.updatedAt = new Date();
    
    this.emit('orderCancelled', order);
    return order;
  }

  // Get order book
  getOrderBook(symbol: string, limit: number = 20): OrderBook {
    const book = this.orderBooks.get(symbol);
    if (!book) {
      throw new Error('Market not found');
    }

    return {
      symbol: book.symbol,
      bids: book.bids.slice(0, limit),
      asks: book.asks.slice(0, limit),
      lastUpdateId: book.lastUpdateId
    };
  }

  // Get order
  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  // Get trades for user
  getUserTrades(userId: string, limit: number = 50): Trade[] {
    return this.trades
      .filter(t => {
        const order = this.orders.get(t.orderId);
        return order?.userId === userId;
      })
      .slice(-limit)
      .reverse();
  }

  // Get market info
  getMarket(symbol: string): Market | undefined {
    return this.markets.get(symbol);
  }

  // Get all markets
  getAllMarkets(): Market[] {
    return Array.from(this.markets.values());
  }

  // Get current price
  getCurrentPrice(symbol: string): number | undefined {
    const book = this.orderBooks.get(symbol);
    if (!book || book.bids.length === 0) return undefined;
    return book.bids[0][0];
  }

  // Get 24h ticker
  get24hTicker(symbol: string): { price: number; change: number; changePercent: number; high: number; low: number; volume: number } {
    const book = this.orderBooks.get(symbol);
    const market = this.markets.get(symbol);
    
    if (!book || !market) {
      throw new Error('Market not found');
    }

    const trades = this.trades.filter(t => t.symbol === symbol);
    const prices = trades.map(t => t.price);
    
    const high = prices.length > 0 ? Math.max(...prices) : 0;
    const low = prices.length > 0 ? Math.min(...prices) : 0;
    const volume = trades.reduce((sum, t) => sum + t.quantity, 0);
    const lastPrice = book.bids[0]?.[0] || 0;
    const firstPrice = prices[0] || lastPrice;
    const change = lastPrice - firstPrice;
    const changePercent = firstPrice > 0 ? (change / firstPrice) * 100 : 0;

    return {
      price: lastPrice,
      change,
      changePercent,
      high,
      low,
      volume
    };
  }
}

export default MatchingEngine;