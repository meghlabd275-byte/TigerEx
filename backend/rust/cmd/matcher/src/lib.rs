//! TigerEx Matching Engine - ultra-low latency order book.
//!
//! Price-time priority (FIFO within a price level). A single incoming order can
//! fill against several resting orders, so `add_order` returns every trade it
//! produced.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// A price usable as a map key.
///
/// f64 is neither `Eq` nor `Hash`, so prices are compared with `total_cmp`.
/// Orders are rejected before reaching the book unless the price is finite and
/// positive, so a total order is well defined here.
#[derive(Debug, Clone, Copy, PartialEq)]
struct PriceKey(f64);

impl Eq for PriceKey {}

impl PartialOrd for PriceKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PriceKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.total_cmp(&other.0)
    }
}

impl PriceKey {
    fn value(&self) -> f64 {
        self.0
    }
}

/// Order side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    pub fn opposite(&self) -> Self {
        match self {
            Side::Buy => Side::Sell,
            Side::Sell => Side::Buy,
        }
    }
}

/// Order type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderType {
    Market,
    Limit,
    StopLoss,
    StopLimit,
}

/// Order status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderStatus {
    Pending,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

/// Order.
#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub price: f64,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub status: OrderStatus,
    pub timestamp: u64,
    pub stop_price: Option<f64>,
}

impl Order {
    pub fn new(
        id: String,
        user_id: String,
        symbol: String,
        side: Side,
        price: f64,
        quantity: f64,
    ) -> Self {
        Self {
            id,
            user_id,
            symbol,
            side,
            order_type: OrderType::Limit,
            price,
            quantity,
            filled_quantity: 0.0,
            status: OrderStatus::Pending,
            timestamp: current_timestamp(),
            stop_price: None,
        }
    }

    pub fn market(id: String, user_id: String, symbol: String, side: Side, quantity: f64) -> Self {
        let mut order = Self::new(id, user_id, symbol, side, 0.0, quantity);
        order.order_type = OrderType::Market;
        order
    }

    pub fn remaining(&self) -> f64 {
        (self.quantity - self.filled_quantity).max(0.0)
    }

    pub fn is_filled(&self) -> bool {
        self.filled_quantity >= self.quantity
    }

    pub fn is_buy(&self) -> bool {
        self.side == Side::Buy
    }

    /// Whether this order can trade at `counter_price`.
    fn accepts(&self, counter_price: f64) -> bool {
        match self.order_type {
            OrderType::Market => true,
            _ => {
                if self.is_buy() {
                    self.price >= counter_price
                } else {
                    self.price <= counter_price
                }
            }
        }
    }
}

/// One price level, holding resting order ids in FIFO order.
#[derive(Debug, Clone)]
pub struct PriceLevel {
    pub price: f64,
    pub order_ids: VecDeque<String>,
    pub total_quantity: f64,
}

impl PriceLevel {
    pub fn new(price: f64) -> Self {
        Self {
            price,
            order_ids: VecDeque::new(),
            total_quantity: 0.0,
        }
    }

    fn push(&mut self, order_id: String, quantity: f64) {
        self.order_ids.push_back(order_id);
        self.total_quantity += quantity;
    }

    fn remove(&mut self, order_id: &str) -> bool {
        if let Some(position) = self.order_ids.iter().position(|id| id == order_id) {
            self.order_ids.remove(position);
            true
        } else {
            false
        }
    }

    fn is_empty(&self) -> bool {
        self.order_ids.is_empty()
    }
}

/// Trade produced by a match.
#[derive(Debug, Clone, PartialEq)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub maker_order_id: String,
    pub taker_order_id: String,
    pub price: f64,
    pub quantity: f64,
    pub timestamp: u64,
}

/// Level for an order book view.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Level {
    pub price: f64,
    pub quantity: f64,
}

/// Order book depth response.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrderBookDepth {
    pub symbol: String,
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
}

/// Order book for a single symbol.
///
/// `orders` is the canonical store; price levels hold order ids only, so a
/// resting order's fill state is never duplicated.
#[derive(Debug, Clone)]
pub struct OrderBook {
    pub symbol: String,
    bids: BTreeMap<PriceKey, PriceLevel>,
    asks: BTreeMap<PriceKey, PriceLevel>,
    orders: HashMap<String, Order>,
}

impl OrderBook {
    pub fn new(symbol: &str) -> Self {
        Self {
            symbol: symbol.to_string(),
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            orders: HashMap::new(),
        }
    }

    /// Submit an order and return every trade it produced.
    pub fn add_order(&mut self, mut order: Order) -> Vec<Trade> {
        if order.quantity <= 0.0 || !order.quantity.is_finite() {
            order.status = OrderStatus::Rejected;
            return Vec::new();
        }
        if order.order_type != OrderType::Market && (order.price <= 0.0 || !order.price.is_finite())
        {
            order.status = OrderStatus::Rejected;
            return Vec::new();
        }

        let mut trades = Vec::new();
        self.match_against_book(&mut order, &mut trades);

        if order.is_filled() {
            order.status = OrderStatus::Filled;
            // A fully filled taker never rests.
            self.orders.insert(order.id.clone(), order);
        } else {
            // Any unfilled remainder of a market order is cancelled.
            let rests = order.order_type != OrderType::Market;
            order.status = if order.filled_quantity > 0.0 {
                OrderStatus::PartiallyFilled
            } else if rests {
                OrderStatus::Open
            } else {
                OrderStatus::Cancelled
            };

            let remaining = order.remaining();
            let price = order.price;
            let side = order.side;
            let id = order.id.clone();
            self.orders.insert(id.clone(), order);

            if rests && remaining > 0.0 {
                let book_side = if side == Side::Buy {
                    &mut self.bids
                } else {
                    &mut self.asks
                };
                book_side
                    .entry(PriceKey(price))
                    .or_insert_with(|| PriceLevel::new(price))
                    .push(id, remaining);
            }
        }

        trades
    }

    /// Fill `incoming` against the opposite side, consuming price levels in
    /// best-price order and resting orders FIFO.
    fn match_against_book(&mut self, incoming: &mut Order, trades: &mut Vec<Trade>) {
        loop {
            if incoming.remaining() <= 0.0 {
                return;
            }

            let best = if incoming.is_buy() {
                self.best_ask()
            } else {
                self.best_bid()
            };
            let counter_price = match best {
                Some((price, _)) => price,
                None => return,
            };

            if !incoming.accepts(counter_price) {
                return;
            }

            let counter_side = if incoming.is_buy() {
                &mut self.asks
            } else {
                &mut self.bids
            };

            let maker_id = {
                let level = match counter_side.get(&PriceKey(counter_price)) {
                    Some(level) => level,
                    None => return,
                };
                match level.order_ids.front() {
                    Some(id) => id.clone(),
                    None => {
                        counter_side.remove(&PriceKey(counter_price));
                        continue;
                    }
                }
            };

            let maker_remaining = match self.orders.get(&maker_id) {
                Some(maker) => maker.remaining(),
                None => {
                    // Stale id; drop it and continue.
                    if let Some(level) = counter_side.get_mut(&PriceKey(counter_price)) {
                        level.remove(&maker_id);
                    }
                    continue;
                }
            };

            let fill_qty = incoming.remaining().min(maker_remaining);
            if fill_qty <= 0.0 {
                if let Some(level) = counter_side.get_mut(&PriceKey(counter_price)) {
                    level.remove(&maker_id);
                }
                continue;
            }

            incoming.filled_quantity += fill_qty;
            if let Some(maker) = self.orders.get_mut(&maker_id) {
                maker.filled_quantity += fill_qty;
                maker.status = if maker.is_filled() {
                    OrderStatus::Filled
                } else {
                    OrderStatus::PartiallyFilled
                };
            }

            let maker_filled = self
                .orders
                .get(&maker_id)
                .map(|maker| maker.is_filled())
                .unwrap_or(true);

            if let Some(level) = counter_side.get_mut(&PriceKey(counter_price)) {
                level.total_quantity = (level.total_quantity - fill_qty).max(0.0);
                if maker_filled {
                    level.remove(&maker_id);
                }
                if level.is_empty() || level.total_quantity <= 0.0 {
                    counter_side.remove(&PriceKey(counter_price));
                }
            }

            trades.push(Trade {
                id: generate_trade_id(),
                symbol: incoming.symbol.clone(),
                maker_order_id: maker_id,
                taker_order_id: incoming.id.clone(),
                price: counter_price,
                quantity: fill_qty,
                timestamp: current_timestamp(),
            });
        }
    }

    /// Remove an order from the book.
    pub fn cancel_order(&mut self, order_id: &str) -> Option<Order> {
        let mut order = self.orders.remove(order_id)?;

        let book_side = if order.side == Side::Buy {
            &mut self.bids
        } else {
            &mut self.asks
        };
        if let Some(level) = book_side.get_mut(&PriceKey(order.price)) {
            if level.remove(order_id) {
                level.total_quantity = (level.total_quantity - order.remaining()).max(0.0);
            }
            if level.is_empty() {
                book_side.remove(&PriceKey(order.price));
            }
        }

        if matches!(
            order.status,
            OrderStatus::Open | OrderStatus::PartiallyFilled
        ) {
            order.status = OrderStatus::Cancelled;
        }
        Some(order)
    }

    pub fn best_bid(&self) -> Option<(f64, f64)> {
        self.bids
            .iter()
            .rev()
            .find(|(_, level)| !level.is_empty())
            .map(|(price, level)| (price.value(), level.total_quantity))
    }

    pub fn best_ask(&self) -> Option<(f64, f64)> {
        self.asks
            .iter()
            .find(|(_, level)| !level.is_empty())
            .map(|(price, level)| (price.value(), level.total_quantity))
    }

    pub fn spread(&self) -> Option<f64> {
        Some(self.best_ask()?.0 - self.best_bid()?.0)
    }

    pub fn get_order(&self, order_id: &str) -> Option<&Order> {
        self.orders.get(order_id)
    }

    pub fn get_user_orders(&self, user_id: &str) -> Vec<&Order> {
        let mut orders: Vec<&Order> = self
            .orders
            .values()
            .filter(|order| {
                order.user_id == user_id
                    && matches!(
                        order.status,
                        OrderStatus::Open | OrderStatus::PartiallyFilled
                    )
            })
            .collect();
        orders.sort_by_key(|order| order.timestamp);
        orders
    }

    /// Get order book depth, best prices first.
    pub fn depth(&self, levels: usize) -> OrderBookDepth {
        let bids: Vec<Level> = self
            .bids
            .values()
            .rev()
            .filter(|level| !level.is_empty())
            .take(levels)
            .map(|level| Level {
                price: level.price,
                quantity: level.total_quantity,
            })
            .collect();
        let asks: Vec<Level> = self
            .asks
            .values()
            .filter(|level| !level.is_empty())
            .take(levels)
            .map(|level| Level {
                price: level.price,
                quantity: level.total_quantity,
            })
            .collect();

        OrderBookDepth {
            symbol: self.symbol.clone(),
            bids,
            asks,
        }
    }

    /// Total quantity resting on the bid side.
    pub fn bid_liquidity(&self) -> f64 {
        self.bids.values().map(|level| level.total_quantity).sum()
    }

    /// Total quantity resting on the ask side.
    pub fn ask_liquidity(&self) -> f64 {
        self.asks.values().map(|level| level.total_quantity).sum()
    }
}

impl Default for OrderBook {
    fn default() -> Self {
        Self::new("DEFAULT")
    }
}

/// Performance counters.
#[derive(Debug, Default, Clone)]
pub struct MatcherMetrics {
    pub orders_processed: u64,
    pub trades_executed: u64,
}

/// Thread-safe order book manager.
pub struct Matcher {
    books: RwLock<HashMap<String, Arc<RwLock<OrderBook>>>>,
    metrics: RwLock<MatcherMetrics>,
}

impl Matcher {
    pub fn new() -> Self {
        Self {
            books: RwLock::new(HashMap::new()),
            metrics: RwLock::new(MatcherMetrics::default()),
        }
    }

    /// Get (creating if needed) the shared order book for a symbol.
    ///
    /// The book is shared, not copied, so orders added through one handle are
    /// visible to every other handle.
    pub fn get_book(&self, symbol: &str) -> Arc<RwLock<OrderBook>> {
        let mut books = self.books.write().unwrap();
        books
            .entry(symbol.to_string())
            .or_insert_with(|| Arc::new(RwLock::new(OrderBook::new(symbol))))
            .clone()
    }

    /// Add an order; returns the trades it produced.
    pub fn add_order(&self, order: Order) -> Vec<Trade> {
        let symbol = order.symbol.clone();
        let book = self.get_book(&symbol);

        let trades = {
            let mut book = book.write().unwrap();
            book.add_order(order)
        };

        let mut metrics = self.metrics.write().unwrap();
        metrics.orders_processed += 1;
        metrics.trades_executed += trades.len() as u64;

        trades
    }

    pub fn cancel_order(&self, symbol: &str, order_id: &str) -> Option<Order> {
        let book = self.get_book(symbol);
        let mut book = book.write().unwrap();
        book.cancel_order(order_id)
    }

    pub fn depth(&self, symbol: &str, levels: usize) -> OrderBookDepth {
        let book = self.get_book(symbol);
        let book = book.read().unwrap();
        book.depth(levels)
    }

    pub fn metrics(&self) -> MatcherMetrics {
        self.metrics.read().unwrap().clone()
    }
}

impl Default for Matcher {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Unique trade id: nanosecond time plus a process-wide counter, so trades in
/// the same nanosecond do not collide.
fn generate_trade_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("trade_{:x}_{}", nanos, sequence)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limit(id: &str, side: Side, price: f64, quantity: f64) -> Order {
        Order::new(
            id.to_string(),
            "user".to_string(),
            "BTC/USDT".to_string(),
            side,
            price,
            quantity,
        )
    }

    #[test]
    fn resting_order_is_visible_in_the_book() {
        let mut book = OrderBook::new("BTC/USDT");
        book.add_order(limit("b1", Side::Buy, 50_000.0, 1.0));

        assert_eq!(book.best_bid(), Some((50_000.0, 1.0)));
        assert_eq!(book.best_ask(), None);
        assert_eq!(book.get_order("b1").unwrap().status, OrderStatus::Open);
    }

    #[test]
    fn crossing_limit_orders_trade_at_the_maker_price() {
        let mut book = OrderBook::new("BTC/USDT");
        book.add_order(limit("ask1", Side::Sell, 50_000.0, 1.0));

        // Buyer is willing to pay 50_100 but the maker's price wins.
        let trades = book.add_order(limit("bid1", Side::Buy, 50_100.0, 1.0));

        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].price, 50_000.0);
        assert_eq!(trades[0].quantity, 1.0);
        assert_eq!(trades[0].maker_order_id, "ask1");
        assert_eq!(trades[0].taker_order_id, "bid1");
        assert_eq!(book.get_order("bid1").unwrap().status, OrderStatus::Filled);
        assert_eq!(book.get_order("ask1").unwrap().status, OrderStatus::Filled);
        assert_eq!(book.best_ask(), None);
        assert_eq!(book.best_bid(), None);
    }

    #[test]
    fn non_crossing_orders_rest() {
        let mut book = OrderBook::new("BTC/USDT");
        book.add_order(limit("ask1", Side::Sell, 50_100.0, 1.0));
        let trades = book.add_order(limit("bid1", Side::Buy, 50_000.0, 1.0));

        assert!(trades.is_empty());
        assert_eq!(book.best_bid(), Some((50_000.0, 1.0)));
        assert_eq!(book.best_ask(), Some((50_100.0, 1.0)));
        assert_eq!(book.spread(), Some(100.0));
    }

    #[test]
    fn one_taker_can_fill_multiple_makers() {
        let mut book = OrderBook::new("BTC/USDT");
        book.add_order(limit("ask1", Side::Sell, 50_000.0, 1.0));
        book.add_order(limit("ask2", Side::Sell, 50_010.0, 1.0));

        let trades = book.add_order(limit("bid1", Side::Buy, 50_020.0, 2.0));

        assert_eq!(trades.len(), 2);
        assert_eq!(trades[0].maker_order_id, "ask1");
        assert_eq!(trades[1].maker_order_id, "ask2");
        assert_eq!(book.get_order("bid1").unwrap().status, OrderStatus::Filled);
        assert_eq!(book.best_ask(), None);
    }

    #[test]
    fn partial_fill_leaves_the_remainder_resting() {
        let mut book = OrderBook::new("BTC/USDT");
        book.add_order(limit("ask1", Side::Sell, 50_000.0, 0.4));

        let trades = book.add_order(limit("bid1", Side::Buy, 50_000.0, 1.0));

        assert_eq!(trades[0].quantity, 0.4);
        let resting = book.get_order("bid1").unwrap();
        assert_eq!(resting.status, OrderStatus::PartiallyFilled);
        assert!((resting.remaining() - 0.6).abs() < 1e-9);
        assert_eq!(book.best_bid(), Some((50_000.0, 0.6)));
    }

    #[test]
    fn fifo_priority_within_a_price_level() {
        let mut book = OrderBook::new("BTC/USDT");
        book.add_order(limit("ask1", Side::Sell, 50_000.0, 1.0));
        book.add_order(limit("ask2", Side::Sell, 50_000.0, 1.0));

        let trades = book.add_order(limit("bid1", Side::Buy, 50_000.0, 1.0));

        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].maker_order_id, "ask1");
        assert_eq!(book.best_ask(), Some((50_000.0, 1.0)));
    }

    #[test]
    fn market_order_sweeps_and_cancels_the_remainder() {
        let mut book = OrderBook::new("BTC/USDT");
        book.add_order(limit("ask1", Side::Sell, 50_000.0, 1.0));

        let market = Order::market(
            "mkt1".to_string(),
            "user".to_string(),
            "BTC/USDT".to_string(),
            Side::Buy,
            5.0,
        );
        let trades = book.add_order(market);

        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].quantity, 1.0);
        // Unfilled market remainder is cancelled, not rested.
        let order = book.get_order("mkt1").unwrap();
        assert_eq!(order.status, OrderStatus::PartiallyFilled);
        assert_eq!(book.best_bid(), None);
    }

    #[test]
    fn cancel_removes_liquidity_and_marks_the_order() {
        let mut book = OrderBook::new("BTC/USDT");
        book.add_order(limit("b1", Side::Buy, 50_000.0, 2.0));

        let cancelled = book.cancel_order("b1").unwrap();
        assert_eq!(cancelled.status, OrderStatus::Cancelled);
        assert_eq!(book.best_bid(), None);
        assert!(book.cancel_order("b1").is_none());
    }

    #[test]
    fn invalid_orders_are_rejected() {
        let mut book = OrderBook::new("BTC/USDT");
        assert!(book
            .add_order(limit("bad1", Side::Buy, 50_000.0, 0.0))
            .is_empty());
        assert!(book.add_order(limit("bad2", Side::Buy, -1.0, 1.0)).is_empty());
        assert!(book.get_order("bad1").is_none());
        assert_eq!(book.best_bid(), None);
    }

    #[test]
    fn depth_returns_best_prices_first() {
        let mut book = OrderBook::new("BTC/USDT");
        for (price, qty) in [(49_000.0, 1.0), (49_500.0, 2.0), (49_900.0, 3.0)] {
            book.add_order(limit(&format!("b{price}"), Side::Buy, price, qty));
        }
        for (price, qty) in [(50_100.0, 1.0), (50_200.0, 2.0)] {
            book.add_order(limit(&format!("a{price}"), Side::Sell, price, qty));
        }

        let depth = book.depth(2);
        assert_eq!(depth.bids.len(), 2);
        assert_eq!(depth.bids[0].price, 49_900.0);
        assert_eq!(depth.bids[1].price, 49_500.0);
        assert_eq!(depth.asks[0].price, 50_100.0);
        assert_eq!(depth.asks[1].price, 50_200.0);
    }

    #[test]
    fn matcher_shares_books_between_calls() {
        let matcher = Matcher::new();
        matcher.add_order(limit("b1", Side::Buy, 50_000.0, 1.0));

        // The book must persist across get_book calls.
        let depth = matcher.depth("BTC/USDT", 5);
        assert_eq!(depth.bids.len(), 1);
        assert_eq!(depth.bids[0].price, 50_000.0);

        let trades = matcher.add_order(limit("s1", Side::Sell, 50_000.0, 1.0));
        assert_eq!(trades.len(), 1);

        let metrics = matcher.metrics();
        assert_eq!(metrics.orders_processed, 2);
        assert_eq!(metrics.trades_executed, 1);
    }

    #[test]
    fn user_orders_exclude_filled_ones() {
        let mut book = OrderBook::new("BTC/USDT");
        let mut open = limit("o1", Side::Buy, 49_000.0, 1.0);
        open.user_id = "alice".to_string();
        book.add_order(open);

        let mut other = limit("o2", Side::Buy, 49_100.0, 1.0);
        other.user_id = "bob".to_string();
        book.add_order(other);

        let orders = book.get_user_orders("alice");
        assert_eq!(orders.len(), 1);
        assert_eq!(orders[0].id, "o1");
        assert!(book.get_user_orders("carol").is_empty());
    }

    #[test]
    fn trade_ids_are_unique() {
        let ids: std::collections::HashSet<String> =
            (0..1_000).map(|_| generate_trade_id()).collect();
        assert_eq!(ids.len(), 1_000);
    }
}
