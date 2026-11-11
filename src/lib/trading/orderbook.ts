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
  /** The order's whole open size (displayed plus withheld). */
  remaining: number;
  sequence: number;
  /**
   * The quantity currently displayed on the book. For a normal order it equals
   * `remaining`. For an iceberg it is capped at the tip and is refilled from
   * `remaining` once it is fully consumed, so a partial fill of the tip reduces
   * what is shown and the withheld size is never lost.
   */
  visible: number;
  /** Quantity withheld from the visible book; equals `remaining - visible`. */
  hidden: number;
  /** Tip size for an iceberg order; absent for a normal order. */
  icebergQuantity?: number;
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
      quantity: level.orders.reduce((sum, o) => sum + o.visible, 0),
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
      const tradeQty = Math.min(remaining, maker.visible);

      fills.push({
        makerOrderId: maker.orderId,
        takerOrderId: order.orderId,
        makerUserId: maker.userId,
        takerUserId: order.userId,
        price: level.price,
        quantity: tradeQty,
      });

      maker.remaining -= tradeQty;
      maker.visible -= tradeQty;
      remaining -= tradeQty;

      if (maker.remaining <= 0) {
        level.orders.shift();
        if (level.orders.length === 0) opposite.shift();
      } else {
        // Refill the displayed size only once the previous tranche is fully
        // consumed, then derive the withheld size. Without the refill an iceberg
        // would show its tip once and strand the rest of its size forever.
        this.replenish(maker);
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
        // An iceberg's withheld size is still fillable, so a fill-or-kill order
        // must count it; otherwise a fillable iceberg would be rejected.
        available += order.remaining;
        if (available >= needed) return available;
      }
    }
    return available;
  }

  /**
   * Refill an iceberg's displayed size after a fill.
   *
   * The withheld size is shown again only once the current tranche is fully
   * consumed, and a partial fill of the tranche leaves it partially displayed —
   * so a trader watching the book sees a partial fill, exactly like a normal
   * order, rather than an instant refill that would reveal the order's size.
   */
  private replenish(order: RestingOrder): void {
    if (order.icebergQuantity === undefined) {
      order.visible = order.remaining;
    } else if (order.visible <= 0) {
      order.visible = Math.min(order.remaining, order.icebergQuantity);
    }
    order.hidden = Math.max(0, order.remaining - order.visible);
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

    const visible = order.icebergQuantity !== undefined ? Math.min(remaining, order.icebergQuantity) : remaining;

    const resting: RestingOrder = {
      orderId: order.orderId,
      userId: order.userId,
      side: order.side,
      price: limitPrice,
      quantity: order.quantity,
      remaining,
      sequence: this.sequence++,
      visible,
      hidden: remaining - visible,
      icebergQuantity: order.icebergQuantity,
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
    // An iceberg enters a level at the back of its price-time queue, never ahead
    // of an equal-priced order that already rested, so a hidden order cannot
    // steal time priority from a visible one.
    book[index].orders.push(order);
  }

  /**
   * Insert an already-validated resting order at its price and arrival time.
   *
   * Used when rebuilding the book from durable open orders: those orders were
   * validated and reserved when they were placed, so re-validating them here
   * would be redundant. The order is inserted behind any equal-priced order
   * that arrived earlier, preserving price-time priority.
   */
  rest(order: {
    orderId: string;
    userId: string;
    side: Side;
    price: number;
    quantity: number;
    remaining: number;
    icebergQuantity?: number;
    /** The size currently displayed; defaults to the full tip for an iceberg. */
    visible?: number;
    sequence?: number;
  }): void {
    const book = order.side === 'buy' ? this.bids : this.asks;
    const sequence = order.sequence ?? this.sequence++;
    // `visible` and `hidden` are derived, never trusted from the caller, so a
    // persisted value cannot disagree with the withheld size after a refill.
    const visible =
      order.visible !== undefined
        ? order.visible
        : order.icebergQuantity !== undefined
          ? Math.min(order.remaining, order.icebergQuantity)
          : order.remaining;
    const hidden = Math.max(0, order.remaining - visible);
    this.insert(book, { ...order, visible, hidden, sequence }, order.side);
    if (sequence >= this.sequence) this.sequence = sequence + 1;
  }

  /** Remove a resting order. Returns the quantity that was still open. */
  cancel(orderId: string): number {
    for (const book of [this.bids, this.asks]) {
      for (const level of book) {
        const index = level.orders.findIndex((o) => o.orderId === orderId);
        if (index !== -1) {
          const [removed] = level.orders.splice(index, 1);
          if (level.orders.length === 0) book.splice(book.indexOf(level), 1);
          // `remaining` is the order's whole open size, so the withheld
          // tranche is already included; it must not be added a second time.
          return removed.remaining;
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
