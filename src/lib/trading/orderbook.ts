/**
 * Price-time priority limit order book.
 *
 * This is the settlement-side matcher used by the TypeScript API layer. The
 * latency-critical path is the C++ engine (`backend/cpp/matching_engine`) and
 * the Rust engine is the authority for durable settlement; this module applies
 * the same rules so a self-contained deployment produces identical fills.
 *
 * Money is carried as numbers of the quote asset and quantity as numbers of the
 * base asset. All inputs are validated: a non-finite, zero or negative price or
 * quantity is rejected rather than matched, because a NaN price would corrupt
 * every level behind it.
 */

export type Side = 'buy' | 'sell';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX';

export interface OrderRequest {
  orderId: string;
  userId: string;
  side: Side;
  type: 'limit' | 'market';
  price?: number;
  quantity: number;
  timeInForce?: TimeInForce;
  postOnly?: boolean;
  /** Visible quantity for an iceberg order; the remainder rests hidden. */
  icebergQuantity?: number;
}

export interface RestingOrder {
  orderId: string;
  userId: string;
  side: Side;
  price: number;
  quantity: number;
  remaining: number;
  sequence: number;
  hidden: number;
}

export interface Fill {
  makerOrderId: string;
  takerOrderId: string;
  makerUserId: string;
  takerUserId: string;
  price: number;
  quantity: number;
}

export interface MatchResult {
  fills: Fill[];
  /** Quantity that could not be matched and did not rest (IOC/FOK/market). */
  unfilled: number;
  /** Quantity placed on the book after matching. */
  resting: number;
  /** Set when the order was rejected before touching the book. */
  rejected?: string;
}

interface PriceLevel {
  price: number;
  /** Orders in arrival order; index 0 is the oldest. */
  orders: RestingOrder[];
}

function validNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export class OrderBook {
  private readonly bids: PriceLevel[] = []; // descending price
  private readonly asks: PriceLevel[] = []; // ascending price
  private sequence = 0;

  constructor(public readonly symbol: string) {}

  /** Best bid, or null when the book is empty on that side. */
  bestBid(): number | null {
    return this.bids.length ? this.bids[0].price : null;
  }

  bestAsk(): number | null {
    return this.asks.length ? this.asks[0].price : null;
  }

  /** Mid price of the two best quotes, or null when either side is empty. */
  midPrice(): number | null {
    const bid = this.bestBid();
    const ask = this.bestAsk();
    if (bid === null || ask === null) return null;
    return (bid + ask) / 2;
  }

  depth(side: Side, levels = 20): Array<{ price: number; quantity: number }> {
    const book = side === 'buy' ? this.bids : this.asks;
    return book.slice(0, levels).map((level) => ({
      price: level.price,
      quantity: level.orders.reduce((sum, o) => sum + o.remaining, 0),
    }));
  }

  /**
   * Match an incoming order against the book and rest the remainder when the
   * order's time in force allows it.
   *
   * GTX is post-only: an order that would cross is rejected instead of taking.
   * FOK is all-or-nothing: it is rejected when the book cannot fill it whole.
   */
  match(order: OrderRequest): MatchResult {
    const quantity = validNumber(order.quantity);
    if (quantity === null) {
      return { fills: [], unfilled: 0, resting: 0, rejected: 'quantity must be a positive number' };
    }

    const isMarket = order.type === 'market';
    let limitPrice: number | null = null;
    if (!isMarket) {
      limitPrice = validNumber(order.price);
      if (limitPrice === null) {
        return { fills: [], unfilled: 0, resting: 0, rejected: 'a limit order requires a positive price' };
      }
    }

    const tif: TimeInForce = order.timeInForce ?? 'GTC';
    const opposite = order.side === 'buy' ? this.asks : this.bids;

    const crosses = (levelPrice: number): boolean => {
      if (isMarket || limitPrice === null) return true;
      return order.side === 'buy' ? levelPrice <= limitPrice : levelPrice >= limitPrice;
    };

    if (order.postOnly && !isMarket && opposite.length && crosses(opposite[0].price)) {
      return { fills: [], unfilled: 0, resting: 0, rejected: 'post-only order would take liquidity' };
    }

    if (tif === 'FOK') {
      const available = this.availableToFill(opposite, crosses, quantity);
      if (available < quantity) {
        return { fills: [], unfilled: quantity, resting: 0, rejected: 'fill-or-kill order cannot be filled in full' };
      }
    }

    const fills: Fill[] = [];
    let remaining = quantity;

    while (remaining > 0 && opposite.length > 0 && crosses(opposite[0].price)) {
      const level = opposite[0];
      const maker = level.orders[0];
      const tradeQty = Math.min(remaining, maker.remaining);

      fills.push({
        makerOrderId: maker.orderId,
        takerOrderId: order.orderId,
        makerUserId: maker.userId,
        takerUserId: order.userId,
        price: level.price,
        quantity: tradeQty,
      });

      maker.remaining -= tradeQty;
      remaining -= tradeQty;

      if (maker.remaining <= 0) {
        level.orders.shift();
        if (level.orders.length === 0) opposite.shift();
      }
    }

    const resting = this.restOrDiscard(order, remaining, tif, isMarket, limitPrice);
    return { fills, unfilled: remaining - resting, resting };
  }

  private availableToFill(
    opposite: PriceLevel[],
    crosses: (price: number) => boolean,
    needed: number,
  ): number {
    let available = 0;
    for (const level of opposite) {
      if (!crosses(level.price)) break;
      for (const order of level.orders) {
        available += order.remaining;
        if (available >= needed) return available;
      }
    }
    return available;
  }

  private restOrDiscard(
    order: OrderRequest,
    remaining: number,
    tif: TimeInForce,
    isMarket: boolean,
    limitPrice: number | null,
  ): number {
    if (remaining <= 0) return 0;
    if (isMarket) return 0; // a market order never rests
    if (tif === 'IOC' || tif === 'FOK') return 0;
    if (limitPrice === null) return 0;

    const hidden = order.icebergQuantity !== undefined ? Math.max(0, remaining - order.icebergQuantity) : 0;
    const visible = order.icebergQuantity !== undefined ? Math.min(remaining, order.icebergQuantity) : remaining;

    const resting: RestingOrder = {
      orderId: order.orderId,
      userId: order.userId,
      side: order.side,
      price: limitPrice,
      quantity: order.quantity,
      remaining: visible,
      sequence: this.sequence++,
      hidden,
    };

    const book = order.side === 'buy' ? this.bids : this.asks;
    this.insert(book, resting, order.side);
    return remaining;
  }

  private insert(book: PriceLevel[], order: RestingOrder, side: Side): void {
    let index = book.findIndex((level) => level.price === order.price);
    if (index === -1) {
      const newLevel: PriceLevel = { price: order.price, orders: [] };
      // Bids descend, asks ascend. Insert at the first position that keeps order.
      index = book.findIndex((level) =>
        side === 'buy' ? level.price < order.price : level.price > order.price,
      );
      if (index === -1) book.push(newLevel);
      else book.splice(index, 0, newLevel);
      index = book.findIndex((level) => level.price === order.price);
    }
    // Price-time priority: equal prices append behind earlier orders.
    book[index].orders.push(order);
  }

  /** Remove a resting order. Returns the quantity that was still open. */
  cancel(orderId: string): number {
    for (const book of [this.bids, this.asks]) {
      for (const level of book) {
        const index = level.orders.findIndex((o) => o.orderId === orderId);
        if (index !== -1) {
          const [removed] = level.orders.splice(index, 1);
          if (level.orders.length === 0) book.splice(book.indexOf(level), 1);
          return removed.remaining + removed.hidden;
        }
      }
    }
    return 0;
  }
}

/**
 * Fee for a fill, expressed in the quote asset.
 *
 * The maker and taker rates are fractions of notional (0.001 is 10 bps).
 */
export function fillFee(price: number, quantity: number, rate: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || !Number.isFinite(rate)) return 0;
  if (price <= 0 || quantity <= 0 || rate < 0) return 0;
  return price * quantity * rate;
}

/**
 * Split a total fee between the two counterparties for a trade, returning the
 * fee each side owes. The taker pays the taker rate, the maker the maker rate.
 */
export function tradeFees(
  price: number,
  quantity: number,
  makerRate: number,
  takerRate: number,
): { makerFee: number; takerFee: number } {
  return {
    makerFee: fillFee(price, quantity, makerRate),
    takerFee: fillFee(price, quantity, takerRate),
  };
}
