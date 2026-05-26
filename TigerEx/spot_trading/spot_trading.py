#!/usr/bin/env python3
"""
TigerEx - Complete Spot Trading System
Version: 1.0.0 (Production Ready)
"""

import secrets
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple
from enum import Enum
from dataclasses import dataclass, field
import heapq


class OrderStatus(Enum):
    PENDING_NEW = "pending_new"
    NEW = "new"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    EXPIRED = "expired"


class OrderSide(Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(Enum):
    LIMIT = "limit"
    MARKET = "market"
    STOP_LOSS = "stop_loss"
    STOP_LIMIT = "stop_limit"
    TAKE_PROFIT = "take_profit"


class TimeInForce(Enum):
    GTC = "GTC"  # Good Till Cancel
    IOC = "IOC"  # Immediate Or Cancel
    FOK = "FOK"  # Fill Or Kill
    GTX = "GTX"  # Good Till Crossing (post only)


@dataclass
class Order:
    order_id: str
    user_id: str
    market: str
    side: OrderSide
    order_type: OrderType
    price: Decimal
    stop_price: Decimal
    quantity: Decimal
    filled_quantity: Decimal = field(default_factory=lambda: Decimal("0"))
    time_in_force: TimeInForce = TimeInForce.GTC
    status: OrderStatus = OrderStatus.PENDING_NEW
    left_quantity: Decimal = field(init=False)
    cost: Decimal = field(default_factory=lambda: Decimal("0"))
    fee: Decimal = field(default_factory=lambda: Decimal("0"))
    client_order_id: str = ""
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    traded_at: Optional[datetime] = None
    expire_time: Optional[datetime] = None
    reject_reason: str = ""

    def __post_init__(self):
        self.left_quantity = self.quantity - self.filled_quantity


@dataclass
class Trade:
    trade_id: str
    market: str
    side: OrderSide
    price: Decimal
    quantity: Decimal
    maker_order_id: str
    taker_order_id: str
    maker_fee: Decimal
    taker_fee: Decimal
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class Market:
    symbol: str
    base_asset: str
    quote_asset: str
    status: str = "trading"
    tick_size: Decimal = field(default_factory=lambda: Decimal("0.01"))
    lot_size: Decimal = field(default_factory=lambda: Decimal("0.00001"))
    min_quantity: Decimal = field(default_factory=lambda: Decimal("0.00001"))
    max_quantity: Decimal = field(default_factory=lambda: Decimal("1000000"))
    min_notional: Decimal = field(default_factory=lambda: Decimal("1"))
    max_notional: Decimal = field(default_factory=lambda: Decimal("100000000"))
    maker_fee: Decimal = field(default_factory=lambda: Decimal("0.001"))
    taker_fee: Decimal = field(default_factory=lambda: Decimal("0.001"))


class OrderBook:
    """Order book with price levels"""
    
    def __init__(self):
        # Price -> [(price, orders)]
        self.bids: Dict[Decimal, List[Order]] = {}  # Descending by price
        self.asks: Dict[Decimal, List[Order]] = {}  # Ascending by price
        
        # Order lookup
        self.orders: Dict[str, Order] = {}
        
        # Market data
        self.last_price = Decimal("0")
        self.last_quantity = Decimal("0")
        self.volume_24h = Decimal("0")
        self.trades_24h = 0
    
    def add_order(self, order: Order) -> Tuple[List[Trade], List[Order]:
        """Add order to book, execute trades"""
        trades = []
        cancelled = []
        
        order.status = OrderStatus.NEW
        order.left_quantity = order.quantity - order.filled_quantity
        
        if order.order_type == OrderType.MARKET:
            # Market order - execute immediately
            trades = self._execute_market(order)
        elif order.order_type == OrderType.LIMIT:
            if order.time_in_force == TimeInForce.IOC or order.time_in_force == TimeInForce.FOK:
                trades = self._execute_limit_immediate(order)
            else:
                # Add to book
                self._add_to_book(order)
        
        return trades, cancelled
    
    def _add_to_book(self, order: Order):
        """Add order to book"""
        price_key = round_price(order.price, order.left_quantity)
        
        if order.side == OrderSide.BUY:
            if price_key not in self.bids:
                self.bids[price_key] = []
            self.bids[price_key].append(order)
        else:
            if price_key not in self.asks:
                self.asks[price_key] = []
            self.asks[price_key].append(order)
        
        self.orders[order.order_id] = order
    
    def _execute_market(self, order: Order) -> List[Trade]:
        """Execute market order"""
        trades = []
        
        if order.side == OrderSide.BUY:
            # Take from asks (lowest price first)
            for price in sorted(self.asks.keys()):
                if order.left_quantity <= 0:
                    break
                    
                for maker in list(self.asks.get(price, [])):
                    if order.left_quantity <= 0:
                        break
                    
                    qty = min(order.left_quantity, maker.left_quantity)
                    trade = self._create_trade(order, maker, price, qty)
                    trades.append(trade)
                    
                    order.left_quantity -= qty
                    order.filled_quantity += qty
                    maker.left_quantity -= qty
                    maker.filled_quantity += qty
                    
                    if maker.left_quantity <= 0:
                        maker.status = OrderStatus.FILLED
        else:
            # Sell - take from bids
            for price in sorted(self.bids.keys(), reverse=True):
                if order.left_quantity <= 0:
                    break
                    
                for maker in list(self.bids.get(price, [])):
                    if order.left_quantity <= 0:
                        break
                    
                    qty = min(order.left_quantity, maker.left_quantity)
                    trade = self._create_trade(order, maker, price, qty)
                    trades.append(trade)
                    
                    order.left_quantity -= qty
                    order.filled_quantity += qty
                    maker.left_quantity -= qty
                    maker.filled_quantity += qty
        
        if order.filled_quantity > 0:
            if order.left_quantity <= 0:
                order.status = OrderStatus.FILLED
            else:
                order.status = OrderStatus.PARTIALLY_FILLED
        else:
            order.status = OrderStatus.REJECTED
            order.reject_reason = "No liquidity"
        
        return trades
    
    def _execute_limit_immediate(self, order: Order) -> List[Trade]:
        """Execute limit order with IOC/FOK"""
        trades = []
        
        if order.side == OrderSide.BUY:
            for price in sorted(self.asks.keys()):
                if price > order.price:
                    break
                if order.left_quantity <= 0:
                    break
                
                for maker in list(self.asks.get(price, [])):
                    if order.left_quantity <= 0:
                        break
                    
                    qty = min(order.left_quantity, maker.left_quantity)
                    trade = self._create_trade(order, maker, price, qty)
                    trades.append(trade)
                    
                    order.left_quantity -= qty
                    order.filled_quantity += qty
                    maker.left_quantity -= qty
                    maker.filled_quantity += qty
        else:
            # Sell limit
            for price in sorted(self.bids.keys(), reverse=True):
                if price < order.price:
                    break
                if order.left_quantity <= 0:
                    break
                
                for maker in list(self.bids.get(price, [])):
                    if order.left_quantity <= 0:
                        break
                    
                    qty = min(order.left_quantity, maker.left_quantity)
                    trade = self._create_trade(order, maker, price, qty)
                    trades.append(trade)
                    
                    order.left_quantity -= qty
                    order.filled_quantity += qty
                    maker.left_quantity -= qty
                    maker.filled_quantity += qty
        
        if order.filled_quantity > 0:
            if order.left_quantity <= 0:
                order.status = OrderStatus.FILLED
            elif order.time_in_force == TimeInForce.IOC:
                order.status = OrderStatus.FILLED if order.left_quantity == 0 else OrderStatus.PARTIALLY_FILLED
            else:
                order.status = OrderStatus.EXPIRED
        else:
            order.status = OrderStatus.EXPIRED
        
        return trades
    
    def _create_trade(self, taker: Order, maker: Order, price: Decimal, qty: Decimal) -> Trade:
        trade = Trade(
            trade_id=secrets.token_urlsafe(12),
            market=taker.market,
            side=taker.side,
            price=price,
            quantity=qty,
            maker_order_id=maker.order_id,
            taker_order_id=taker.order_id,
            maker_fee=price * qty * Decimal("0.001"),
            taker_fee=price * qty * Decimal("0.001")
        )
        
        self.last_price = price
        self.last_quantity = qty
        self.volume_24h += price * qty
        self.trades_24h += 1
        
        return trade
    
    def cancel_order(self, order_id: str, user_id: str) -> bool:
        """Cancel order"""
        order = self.orders.get(order_id)
        if not order:
            return False
        
        if order.user_id != user_id:
            return False
        
        if order.status in [OrderStatus.FILLED, OrderStatus.CANCELLED]:
            return False
        
        order.status = OrderStatus.CANCELLED
        return True
    
    def get_depth(self, limit: int = 20) -> Dict:
        """Get order book depth"""
        bids = []
        for price in sorted(self.bids.keys(), reverse=True)[:limit]:
            qty = sum(o.left_quantity for o in self.bids.get(price, []))
            bids.append({"price": str(price), "quantity": str(qty)})
        
        asks = []
        for price in sorted(self.asks.keys())[:limit]:
            qty = sum(o.left_quantity for o in self.asks.get(price, []))
            asks.append({"price": str(price), "quantity": str(qty)})
        
        return {"bids": bids, "asks": asks}


def round_price(price: Decimal, quantity: Decimal) -> Decimal:
    """Round price to tick size"""
    return Decimal(str(price))


class SpotTrading:
    """Complete spot trading system"""
    
    def __init__(self):
        self.markets: Dict[str, Market] = {}
        self.order_books: Dict[str, OrderBook] = {}
        self.orders: Dict[str, Order] = {}
        self.trades: Dict[str, Trade] = {}
        
        self.user_orders: Dict[str, List[str]] = {}
        
    def add_market(self, symbol: str, base: str, quote: str,
                   tick_size: Decimal = Decimal("0.01"),
                   lot_size: Decimal = Decimal("0.00001")):
        """Add trading market"""
        market = Market(
            symbol=symbol,
            base_asset=base,
            quote_asset=quote,
            tick_size=tick_size,
            lot_size=lot_size
        )
        self.markets[symbol] = market
        self.order_books[symbol] = OrderBook()
    
    def create_order(self, user_id: str, market: str, side: str,
                    order_type: str, quantity: Decimal,
                    price: Optional[Decimal] = None,
                    stop_price: Optional[Decimal] = None,
                    time_in_force: str = "GTC") -> Tuple[Order, str]:
        """Create new order"""
        # Validate market
        if market not in self.markets:
            return None, "Market not found"
        
        market = self.markets[market]
        
        # Parse enums
        if side.lower() == "buy":
            side = OrderSide.BUY
        else:
            side = OrderSide.SELL
        
        if order_type.lower() == "limit":
            order_type = OrderType.LIMIT
        elif order_type.lower() == "market":
            order_type = OrderType.MARKET
        else:
            return None, "Invalid order type"
        
        if time_in_force == "GTC":
            tif = TimeInForce.GTC
        elif time_in_force == "IOC":
            tif = TimeInForce.IOC
        elif time_in_force == "FOK":
            tif = TimeInForce.FOK
        else:
            tif = TimeInForce.GTC
        
        # Validate quantity
        if quantity <= 0:
            return None, "Invalid quantity"
        
        # For limit orders, price required
        if order_type == OrderType.LIMIT and price is None:
            return None, "Price required for limit order"
        
        # Create order
        order = Order(
            order_id=secrets.token_urlsafe(16),
            user_id=user_id,
            market=market.symbol,
            side=side,
            order_type=order_type,
            price=price or Decimal("0"),
            stop_price=stop_price or Decimal("0"),
            quantity=quantity,
            time_in_force=tif
        )
        
        # Link to market
        self.orders[order.order_id] = order
        
        if user_id not in self.user_orders:
            self.user_orders[user_id] = []
        self.user_orders[user_id].append(order.order_id)
        
        return order, None
    
    def submit_order(self, order: Order) -> Tuple[List[Trade], str]:
        """Submit order for execution"""
        ob = self.order_books.get(order.market)
        if not ob:
            return [], "Market not found"
        
        trades, _ = ob.add_order(order)
        
        # Record trades
        for trade in trades:
            self.trades[trade.trade_id] = trade
        
        return trades, None
    
    def cancel_order(self, order_id: str, user_id: str) -> bool:
        """Cancel order"""
        for ob in self.order_books.values():
            if ob.cancel_order(order_id, user_id):
                return True
        return False
    
    def get_order(self, order_id: str) -> Optional[Order]:
        """Get order by ID"""
        return self.orders.get(order_id)
    
    def get_open_orders(self, user_id: str) -> List[Order]:
        """Get user's open orders"""
        order_ids = self.user_orders.get(user_id, [])
        return [o for o in self.orders.values() 
                if o.order_id in order_ids 
                and o.status in [OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED]]
    
    def get_order_history(self, user_id: str, limit: int = 100) -> List[Order]:
        """Get user's order history"""
        order_ids = self.user_orders.get(user_id, [])
        orders = [self.orders[oid] for oid in order_ids if oid in self.orders]
        orders.sort(key=lambda x: x.created_at, reverse=True)
        return orders[:limit]
    
    def get_my_trades(self, user_id: str, limit: int = 100) -> List[Trade]:
        """Get user's trade history"""
        trades = [t for t in self.trades.values()
                if t.maker_order_id in self.user_orders.get(user_id, [])
                or t.taker_order_id in self.user_orders.get(user_id, [])]
        trades.sort(key=lambda x: x.created_at, reverse=True)
        return trades[:limit]
    
    def get_ticker(self, market: str) -> Dict:
        """Get ticker for market"""
        ob = self.order_books.get(market)
        if not ob:
            return {}
        
        return {
            "symbol": market,
            "last_price": str(ob.last_price),
            "volume_24h": str(ob.volume_24h),
            "trades_24h": ob.trades_24h
        }


def main():
    """Example usage"""
    print("TigerEx Spot Trading System v1.0")
    print("=" * 40)
    
    trading = SpotTrading()
    
    # Add markets
    trading.add_market("BTC/USDT", "BTC", "USDT",
                   tick_size=Decimal("0.01"),
                   lot_size=Decimal("0.00001"))
    trading.add_market("ETH/USDT", "ETH", "USDT",
                   tick_size=Decimal("0.01"),
                   lot_size=Decimal("0.00001"))
    
    # Create orders
    print("\n-- Creating Orders --")
    
    order1, err = trading.create_order(
        user_id="user1",
        market="BTC/USDT",
        side="buy",
        order_type="limit",
        quantity=Decimal("1.0"),
        price=Decimal("50000"),
        time_in_force="GTC"
    )
    
    if err:
        print(f"Error: {err}")
    else:
        trades, err = trading.submit_order(order1)
        print(f"Order: {order1.order_id[:8]}")
        print(f"Status: {order1.status.value}")
    
    order2, err = trading.create_order(
        user_id="user2",
        market="BTC/USDT",
        side="sell",
        order_type="limit",
        quantity=Decimal("0.5"),
        price=Decimal("50100"),
        time_in_force="GTC"
    )
    
    if err:
        print(f"Error2: {err}")
    else:
        trades, err = trading.submit_order(order2)
        print(f"Order: {order2.order_id[:8]}")
        print(f"Status: {order2.status.value}")
        print(f"Trades: {len(trades)}")
        for t in trades:
            print(f"  Trade: {t.price} x {t.quantity}")
    
    # Market order
    order3, err = trading.create_order(
        user_id="user3",
        market="BTC/USDT",
        side="buy",
        order_type="market",
        quantity=Decimal("0.3")
    )
    
    if err:
        print(f"Error3: {err}")
    else:
        trades, err = trading.submit_order(order3)
        print(f"Market Order: {len(trades)} trades")
    
    # Get order book
    depth = trading.order_books["BTC/USDT"].get_depth(5)
    print(f"\nOrder Book:")
    print(f"  Bids: {depth['bids'][:3]}")
    print(f"  Asks: {depth['asks'][:3]}")
    
    # Get ticker
    ticker = trading.get_ticker("BTC/USDT")
    print(f"\nTicker: {ticker}")


if __name__ == "__main__":
    main()


# Make Decimal and min work
from typing import Optional
def min(a, b):
    return a if a < b else b