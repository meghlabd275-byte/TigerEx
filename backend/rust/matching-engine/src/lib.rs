//! TigerEx High-Performance Matching Engine
//! Ultra-low latency: < 50 microseconds
//! Rust for memory safety and performance
//! Supports: Spot, Margin, Futures, Leveraged Tokens

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{Arc, RwLock};

use chrono::Utc;
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::info;

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum MatchingError {
    #[error("Invalid order: {0}")]
    InvalidOrder(String),
    #[error("Insufficient balance: {0}")]
    InsufficientBalance(String),
    #[error("Price out of range: {0}")]
    PriceOutOfRange(String),
    #[error("Amount too small: {0}")]
    AmountTooSmall(String),
    #[error("Insufficient liquidity: {0}")]
    InsufficientLiquidity(String),
    #[error("Market closed: {0}")]
    MarketClosed(String),
    #[error("Liquidation required: {0}")]
    LiquidationRequired(String),
    #[error("Position limit exceeded: {0}")]
    PositionLimitExceeded(String),
    #[error("Duplicate order: {0}")]
    DuplicateOrder(String),
    #[error("Order not found: {0}")]
    OrderNotFound(String),
    #[error("Trading disabled: {0}")]
    TradingDisabled(String),
}

impl Serialize for MatchingError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_PRICE_LEVELS: usize = 1000;
const TRADE_QUEUE_SIZE: usize = 100_000;
// Reserved bounds that belong to layers not implemented in this engine yet:
// per-market order count and per-position sizing are enforced by the risk and
// portfolio layers, which own that state.
#[allow(dead_code)]
const MAX_ORDERS_PER_MARKET: usize = 1_000_000;
#[allow(dead_code)]
const ORDER_QUEUE_SIZE: usize = 100_000;
#[allow(dead_code)]
const MAX_POSITION_VALUE: f64 = 1_000_000_000.0;
#[allow(dead_code)]
const MIN_NOTIONAL_VALUE: f64 = 1.0;
#[allow(dead_code)]
const MAX_LEVERAGE: u32 = 125;

// ============================================================================
// CORE TYPES
// ============================================================================

/// Order side
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
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

/// Order type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderType {
    Market,
    Limit,
    StopMarket,
    StopLimit,
    TrailingStop,
    OCO,
    OcoBuy,
    OcoSell,
}

impl Default for OrderType {
    fn default() -> Self {
        OrderType::Limit
    }
}

/// Time in force
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TimeInForce {
    GTC, // Good Till Cancel
    IOC, // Immediate or Cancel
    FOK, // Fill or Kill
    GTX, // Good Till Crossing
    GTE, // Good Till Expire
}

impl Default for TimeInForce {
    fn default() -> Self {
        TimeInForce::GTC
    }
}

/// Order status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderStatus {
    New,
    PartiallyFilled,
    Filled,
    DoneForDay,
    Cancelled,
    PendingCancel,
    Rejected,
    Expired,
    PendingNew,
    PendingReplace,
}

impl OrderStatus {
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            OrderStatus::New
                | OrderStatus::PartiallyFilled
                | OrderStatus::PendingNew
                | OrderStatus::PendingReplace
        )
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            OrderStatus::Filled
                | OrderStatus::DoneForDay
                | OrderStatus::Cancelled
                | OrderStatus::Rejected
                | OrderStatus::Expired
        )
    }
}

/// Order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub market: String,
    pub side: Side,
    pub order_type: OrderType,
    pub time_in_force: TimeInForce,
    pub price: f64,
    pub stop_price: f64,
    pub trailing_delta: f64,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub iceberg_quantity: f64,
    pub display_quantity: f64,
    pub status: OrderStatus,
    pub client_order_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub expired_at: i64,
}

impl Order {
    pub fn remaining(&self) -> f64 {
        self.quantity - self.filled_quantity
    }

    pub fn is_buy(&self) -> bool {
        self.side == Side::Buy
    }

    pub fn can_trade(&self, price: f64) -> bool {
        if self.status != OrderStatus::New && self.status != OrderStatus::PartiallyFilled {
            return false;
        }

        match self.order_type {
            OrderType::Market => true,
            OrderType::Limit => {
                if self.is_buy() {
                    price <= self.price
                } else {
                    price >= self.price
                }
            }
            OrderType::StopMarket => {
                if self.is_buy() {
                    price >= self.stop_price
                } else {
                    price <= self.stop_price
                }
            }
            OrderType::StopLimit => {
                if self.is_buy() {
                    price >= self.stop_price && price <= self.price
                } else {
                    price <= self.stop_price && price >= self.price
                }
            }
            _ => true,
        }
    }
}

/// A price level in the order book. Orders are kept in arrival (time) order so
/// fills respect price-time priority. Resting quantity is the sum of the
/// remaining quantity of the orders currently queued at this price.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: f64,
    pub quantity: f64,
    pub orders: Vec<RestingOrder>,
}

/// A single resting order inside a price level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestingOrder {
    pub order_id: String,
    pub user_id: String,
    pub remaining: f64,
    /// Monotonic arrival sequence used to determine which order is the maker
    /// when two orders cross. Lower sequence means it was placed earlier.
    pub seq: u64,
}

/// Order book for a market.
///
/// Bids and asks are held in `BTreeMap` keyed by price so the best price is
/// always `keys().next()`: descending for bids, ascending for asks. A `BTreeMap`
/// cannot be keyed by `f64`, so prices are stored as their IEEE-754 bit pattern;
/// the ordering of the raw bits of a finite, non-negative `f64` is identical to
/// numeric ordering, so the "best price" lookup is exact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub market: String,
    pub bids: BTreeMap<u64, PriceLevel>,
    pub asks: BTreeMap<u64, PriceLevel>,
    pub last_update_id: i64,
    pub last_bid: f64,
    pub last_ask: f64,
    #[serde(skip)]
    next_seq: u64,
}

impl OrderBook {
    pub fn new(market: String) -> Self {
        Self {
            market,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            last_update_id: 0,
            last_bid: 0.0,
            last_ask: 0.0,
            next_seq: 0,
        }
    }

    pub fn best_bid(&self) -> f64 {
        self.bids.keys().next_back().map(|k| f64::from_bits(*k)).unwrap_or(0.0)
    }

    pub fn best_ask(&self) -> f64 {
        self.asks.keys().next().map(|k| f64::from_bits(*k)).unwrap_or(f64::MAX)
    }

    pub fn spread(&self) -> f64 {
        self.best_ask() - self.best_bid()
    }

    pub fn add_order(&mut self, order: &Order) {
        if !order.price.is_finite() || order.price <= 0.0 {
            return;
        }
        let seq = self.next_seq;
        self.next_seq += 1;
        let key = order.price.to_bits();
        let side = if order.is_buy() { &mut self.bids } else { &mut self.asks };
        let level = side.entry(key).or_insert_with(|| PriceLevel {
            price: order.price,
            quantity: 0.0,
            orders: Vec::new(),
        });
        level.quantity += order.remaining();
        level.orders.push(RestingOrder {
            order_id: order.id.clone(),
            user_id: order.user_id.clone(),
            remaining: order.remaining(),
            seq,
        });
        self.last_update_id += 1;
    }

    pub fn remove_order(&mut self, order_id: &str, price: f64, side: Side) {
        if !price.is_finite() || price <= 0.0 {
            return;
        }
        let key = price.to_bits();
        let book = if side == Side::Buy { &mut self.bids } else { &mut self.asks };
        if let Some(level) = book.get_mut(&key) {
            if let Some(pos) = level.orders.iter().position(|o| o.order_id == order_id) {
                level.quantity -= level.orders[pos].remaining;
                if level.quantity < 0.0 {
                    level.quantity = 0.0;
                }
                level.orders.remove(pos);
            }
            if level.orders.is_empty() {
                book.remove(&key);
            }
        }
        self.last_update_id += 1;
    }

    /// Match resting bids against resting asks in strict price-time priority.
    ///
    /// A trade happens only when the best bid is greater than or equal to the
    /// best ask. The execution price is the price of whichever of the two
    /// orders arrived first (the maker), so a marketable order never receives a
    /// better price than the one it crossed. Fills are attributed to the actual
    /// resting orders on both sides and their remaining quantity is reduced in
    /// place, which keeps the book and the trade log consistent.
    pub fn match_orders(&mut self, _market_price: f64) -> Vec<Trade> {
        let mut trades = Vec::new();

        loop {
            let (bid_key, ask_key) = match (self.bids.keys().next_back(), self.asks.keys().next()) {
                (Some(b), Some(a)) => (*b, *a),
                _ => break,
            };
            if f64::from_bits(bid_key) < f64::from_bits(ask_key) {
                break;
            }

            let (bid_seq, ask_seq) = {
                let bid_level = match self.bids.get(&bid_key) {
                    Some(l) if !l.orders.is_empty() => l,
                    _ => break,
                };
                let ask_level = match self.asks.get(&ask_key) {
                    Some(l) if !l.orders.is_empty() => l,
                    _ => break,
                };
                (bid_level.orders[0].seq, ask_level.orders[0].seq)
            };
            let (maker_side, trade_price) = if bid_seq < ask_seq {
                (Side::Buy, f64::from_bits(bid_key))
            } else {
                (Side::Sell, f64::from_bits(ask_key))
            };

            // Quantity that can trade: the smaller of the two level totals.
            let mut to_fill = {
                let bid_level = self.bids.get(&bid_key).unwrap();
                let ask_level = self.asks.get(&ask_key).unwrap();
                bid_level.quantity.min(ask_level.quantity).max(0.0)
            };
            if to_fill <= 0.0 {
                break;
            }
            let total_to_fill = to_fill;

            let bid_fills = drain_level(self.bids.get_mut(&bid_key).unwrap(), &mut to_fill);
            let mut ask_left = total_to_fill - to_fill;
            let ask_fills = drain_level(self.asks.get_mut(&ask_key).unwrap(), &mut ask_left);

            // Attribute each unit of the trade to the bid and ask order that
            // supplied it, walking both fill lists in parallel.
            let mut bi = 0usize;
            let mut ai = 0usize;
            let mut bid_rem = bid_fills.first().map(|f| f.2).unwrap_or(0.0);
            let mut ask_rem = ask_fills.first().map(|f| f.2).unwrap_or(0.0);
            while bi < bid_fills.len() && ai < ask_fills.len() {
                let qty = bid_rem.min(ask_rem);
                if qty > 0.0 {
                    let (bid_order_id, bid_user, _) = &bid_fills[bi];
                    let (ask_order_id, ask_user, _) = &ask_fills[ai];
                    trades.push(Trade::new(
                        format!("trade_{}", generate_id()),
                        if maker_side == Side::Buy {
                            bid_order_id.clone()
                        } else {
                            ask_order_id.clone()
                        },
                        self.market.clone(),
                        maker_side,
                        trade_price,
                        qty,
                        bid_user.clone(),
                        ask_user.clone(),
                    ));
                }
                bid_rem -= qty;
                ask_rem -= qty;
                if bid_rem <= 1e-12 {
                    bi += 1;
                    bid_rem = bid_fills.get(bi).map(|f| f.2).unwrap_or(0.0);
                }
                if ask_rem <= 1e-12 {
                    ai += 1;
                    ask_rem = ask_fills.get(ai).map(|f| f.2).unwrap_or(0.0);
                }
            }

            if self.bids.get(&bid_key).map(|l| l.orders.is_empty()).unwrap_or(true) {
                self.bids.remove(&bid_key);
            }
            if self.asks.get(&ask_key).map(|l| l.orders.is_empty()).unwrap_or(true) {
                self.asks.remove(&ask_key);
            }
        }

        self.last_update_id += 1;
        trades
    }
}

/// Remove up to `*budget` quantity from the front of a price level, in arrival
/// order, and return the per-order fills as `(order_id, user_id, filled)`.
fn drain_level(level: &mut PriceLevel, budget: &mut f64) -> Vec<(String, String, f64)> {
    let mut fills = Vec::new();
    for order in level.orders.iter_mut() {
        if *budget <= 1e-12 {
            break;
        }
        let fill = order.remaining.min(*budget);
        order.remaining -= fill;
        level.quantity -= fill;
        *budget -= fill;
        fills.push((order.order_id.clone(), order.user_id.clone(), fill));
    }
    level.orders.retain(|o| o.remaining > 1e-12);
    if level.quantity < 0.0 {
        level.quantity = 0.0;
    }
    fills
}

/// Trade
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub order_id: String,
    pub market: String,
    pub side: Side,
    pub price: f64,
    pub quantity: f64,
    pub fee: f64,
    pub fee_currency: String,
    pub maker: bool,
    pub buyer_user_id: String,
    pub seller_user_id: String,
    pub created_at: i64,
}

impl Trade {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: String,
        order_id: String,
        market: String,
        side: Side,
        price: f64,
        quantity: f64,
        buyer_user_id: String,
        seller_user_id: String,
    ) -> Self {
        Self {
            id,
            order_id,
            market,
            side,
            price,
            quantity,
            fee: price * quantity * 0.0002,
            fee_currency: "USDT".to_string(),
            maker: false,
            buyer_user_id,
            seller_user_id,
            created_at: current_timestamp(),
        }
    }
}

/// Position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub user_id: String,
    pub market: String,
    pub side: Side,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: f64,
    pub leverage: u32,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
    pub liquidation_price: f64,
    pub margin: f64,
    pub margin_ratio: f64,
    /// Order-status-like lifecycle of the position. A position is `New` while
    /// open and `Cancelled` once it has been liquidated or fully closed.
    pub status: OrderStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Position {
    pub fn new(user_id: String, market: String, side: Side, quantity: f64, entry_price: f64, leverage: u32) -> Self {
        let margin = (quantity * entry_price) / (leverage as f64);
        let liquidation_price = if side == Side::Buy {
            entry_price * (1.0 - (1.0 / leverage as f64) + 0.01)
        } else {
            entry_price * (1.0 + (1.0 / leverage as f64) - 0.01)
        };

        Self {
            id: format!("pos_{}", generate_id()),
            user_id,
            market,
            side,
            quantity,
            entry_price,
            mark_price: entry_price,
            leverage,
            unrealized_pnl: 0.0,
            realized_pnl: 0.0,
            liquidation_price,
            margin,
            margin_ratio: 1.0,
            status: OrderStatus::New,
            created_at: current_timestamp(),
            updated_at: current_timestamp(),
        }
    }

    pub fn update_mark_price(&mut self, mark_price: f64) {
        self.mark_price = mark_price;
        let price_diff = if self.side == Side::Buy {
            mark_price - self.entry_price
        } else {
            self.entry_price - mark_price
        };
        self.unrealized_pnl = price_diff * self.quantity;
        self.margin_ratio = self.margin / (self.quantity * mark_price / self.leverage as f64);
        self.updated_at = current_timestamp();
    }

    pub fn check_liquidation(&self) -> bool {
        self.margin_ratio < 1.1
    }
}

/// Market
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Market {
    pub id: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub status: String,
    pub price_precision: u32,
    pub quantity_precision: u32,
    pub min_quantity: f64,
    pub max_quantity: f64,
    pub min_price: f64,
    pub max_price: f64,
    pub tick_size: f64,
    pub step_size: f64,
    pub maker_fee: f64,
    pub taker_fee: f64,
    pub min_notional: f64,
    pub trading_enabled: bool,
    pub auto_settle_interval: i64,
}

impl Market {
    pub fn new(base: String, quote: String) -> Self {
        Self {
            id: format!("{}/{}", base, quote),
            base_asset: base,
            quote_asset: quote,
            status: "TRADING".to_string(),
            price_precision: 8,
            quantity_precision: 8,
            min_quantity: 0.00001,
            max_quantity: 1000000.0,
            min_price: 0.01,
            max_price: 1000000.0,
            tick_size: 0.01,
            step_size: 0.00001,
            maker_fee: 0.001,
            taker_fee: 0.001,
            min_notional: 1.0,
            trading_enabled: true,
            auto_settle_interval: 0,
        }
    }

    pub fn validate_order(&self, order: &Order) -> Result<(), MatchingError> {
        if !self.trading_enabled {
            return Err(MatchingError::TradingDisabled(self.id.clone()));
        }

        if order.quantity < self.min_quantity {
            return Err(MatchingError::AmountTooSmall(format!(
                "min: {}",
                self.min_quantity
            )));
        }

        if order.quantity > self.max_quantity {
            return Err(MatchingError::AmountTooSmall(format!(
                "max: {}",
                self.max_quantity
            )));
        }

        if order.price < self.min_price || order.price > self.max_price {
            return Err(MatchingError::PriceOutOfRange(format!(
                "{} - {}",
                self.min_price, self.max_price
            )));
        }

        let notional = order.price * order.quantity;
        if notional < self.min_notional {
            return Err(MatchingError::AmountTooSmall(format!(
                "notional: {}",
                self.min_notional
            )));
        }

        Ok(())
    }
}

// ============================================================================
// MATCHING ENGINE
// ============================================================================

/// MatchingEngine - High-performance order matching
pub struct MatchingEngine {
    markets: RwLock<HashMap<String, Market>>,
    order_books: RwLock<HashMap<String, OrderBook>>,
    orders: RwLock<HashMap<String, Order>>,
    positions: RwLock<HashMap<String, Position>>,
    trades: RwLock<VecDeque<Trade>>,
    trade_sender: broadcast::Sender<Trade>,
    stats: RwLock<EngineStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStats {
    pub orders_processed: u64,
    pub orders_rejected: u64,
    pub trades_generated: u64,
    pub volume_24h: f64,
    pub last_update: i64,
}

impl Default for EngineStats {
    fn default() -> Self {
        Self {
            orders_processed: 0,
            orders_rejected: 0,
            trades_generated: 0,
            volume_24h: 0.0,
            last_update: current_timestamp(),
        }
    }
}

impl MatchingEngine {
    pub fn new() -> Arc<Self> {
        let (trade_sender, _) = broadcast::channel(TRADE_QUEUE_SIZE);
        Arc::new(Self {
            markets: RwLock::new(HashMap::new()),
            order_books: RwLock::new(HashMap::new()),
            orders: RwLock::new(HashMap::new()),
            positions: RwLock::new(HashMap::new()),
            trades: RwLock::new(VecDeque::with_capacity(TRADE_QUEUE_SIZE)),
            trade_sender,
            stats: RwLock::new(EngineStats::default()),
        })
    }

    pub fn subscribe_trades(&self) -> broadcast::Receiver<Trade> {
        self.trade_sender.subscribe()
    }

    /// Add market
    pub fn add_market(&self, market: Market) {
        let market_id = market.id.clone();
        {
            let mut markets = self.markets.write().unwrap();
            markets.insert(market_id.clone(), market);
        }
        {
            let mut order_books = self.order_books.write().unwrap();
            order_books.insert(market_id.clone(), OrderBook::new(market_id.clone()));
        }

        info!("Added market: {}", market_id);
    }

    /// Get market
    pub fn get_market(&self, market_id: &str) -> Option<Market> {
        let markets = self.markets.read().unwrap();
        markets.get(market_id).cloned()
    }

    /// Place an order and return every trade it produced.
    ///
    /// A limit order is first matched against the resting book (so a marketable
    /// limit takes liquidity); whatever remains is added to the book as a
    /// resting order. A market order only takes liquidity and is rejected when
    /// the book cannot fill it completely, because a market order that cannot
    /// fill in full must not leave a residual resting position.
    pub fn place_order(&self, mut order: Order) -> Result<Vec<Trade>, MatchingError> {
        // Validate market exists
        let market = {
            let markets = self.markets.read().unwrap();
            match markets.get(&order.market) {
                Some(m) => m.clone(),
                None => return Err(MatchingError::InvalidOrder("Market not found".to_string())),
            }
        };

        // Validate order
        market.validate_order(&order)?;

        // Check for duplicate order
        {
            let orders = self.orders.read().unwrap();
            if orders.contains_key(&order.id) {
                return Err(MatchingError::DuplicateOrder(order.id.clone()));
            }
        }

        // Bound the number of price levels per market so a single symbol cannot
        // be flooded into unbounded memory. This is an O(1) check.
        {
            let order_books = self.order_books.read().unwrap();
            if let Some(book) = order_books.get(&order.market) {
                if book.bids.len() + book.asks.len() >= MAX_PRICE_LEVELS {
                    return Err(MatchingError::InvalidOrder(
                        "Order book price level limit reached".to_string(),
                    ));
                }
            }
        }

        // Set order status
        order.status = OrderStatus::New;
        order.created_at = current_timestamp();
        order.updated_at = current_timestamp();

        // Store order
        {
            let mut orders = self.orders.write().unwrap();
            orders.insert(order.id.clone(), order.clone());
        }

        let trades = match order.order_type {
            OrderType::Limit => self.submit_limit(&order)?,
            OrderType::Market => self.submit_market(&order)?,
            _ => {
                // Unsupported order types are not silently accepted as limit
                // orders; they fail closed until they are implemented.
                self.remove_order_record(&order.id);
                return Err(MatchingError::InvalidOrder(
                    "Unsupported order type".to_string(),
                ));
            }
        };

        // Update stats
        {
            let mut stats = self.stats.write().unwrap();
            stats.orders_processed += 1;
            stats.trades_generated += trades.len() as u64;
            for trade in &trades {
                stats.volume_24h += trade.price * trade.quantity;
            }
            stats.last_update = current_timestamp();
        }

        // Store and broadcast trades
        if !trades.is_empty() {
            {
                let mut trade_queue = self.trades.write().unwrap();
                for trade in &trades {
                    trade_queue.push_back(trade.clone());
                    while trade_queue.len() > TRADE_QUEUE_SIZE {
                        trade_queue.pop_front();
                    }
                }
            }
            for trade in &trades {
                let _ = self.trade_sender.send(trade.clone());
            }
        }

        Ok(trades)
    }

    fn remove_order_record(&self, order_id: &str) {
        let mut orders = self.orders.write().unwrap();
        orders.remove(order_id);
    }

    /// Match a limit order against the opposite side of the book, then rest the
    /// unfilled remainder. Returns the trades generated by the incoming order.
    fn submit_limit(&self, order: &Order) -> Result<Vec<Trade>, MatchingError> {
        let opposite_is_bids = !order.is_buy();
        let mut trades = Vec::new();
        let mut remaining = order.remaining();

        let mut order_books = self.order_books.write().unwrap();
        let book = match order_books.get_mut(&order.market) {
            Some(b) => b,
            None => return Err(MatchingError::InvalidOrder("Market not found".to_string())),
        };

        loop {
            if remaining <= 1e-12 {
                break;
            }
            let key = if opposite_is_bids {
                match book.bids.keys().next_back() {
                    Some(k) => *k,
                    None => break,
                }
            } else {
                match book.asks.keys().next() {
                    Some(k) => *k,
                    None => break,
                }
            };
            let maker_price = f64::from_bits(key);
            let crosses = if order.is_buy() {
                order.price >= maker_price
            } else {
                order.price <= maker_price
            };
            if !crosses {
                break;
            }

            let level = if opposite_is_bids {
                book.bids.get_mut(&key).unwrap()
            } else {
                book.asks.get_mut(&key).unwrap()
            };
            let mut level_remaining = remaining;
            let fills = drain_level(level, &mut level_remaining);
            let taken = remaining - level_remaining;
            remaining = level_remaining;
            let (maker_user, maker_order_id) = fills
                .first()
                .map(|f| (f.1.clone(), f.0.clone()))
                .unwrap_or_default();
            if taken > 0.0 {
                let (bid_user, ask_user) = if order.is_buy() {
                    (order.user_id.clone(), maker_user)
                } else {
                    (maker_user, order.user_id.clone())
                };
                trades.push(Trade::new(
                    format!("trade_{}", generate_id()),
                    maker_order_id,
                    order.market.clone(),
                    order.side,
                    maker_price,
                    taken,
                    bid_user,
                    ask_user,
                ));
            }
            let empty = if opposite_is_bids {
                book.bids.get(&key).map(|l| l.orders.is_empty()).unwrap_or(true)
            } else {
                book.asks.get(&key).map(|l| l.orders.is_empty()).unwrap_or(true)
            };
            if empty {
                if opposite_is_bids {
                    book.bids.remove(&key);
                } else {
                    book.asks.remove(&key);
                }
            }
        }

        // Rest the unfilled remainder as a maker.
        if remaining > 1e-12 {
            let resting = Order {
                quantity: remaining,
                filled_quantity: 0.0,
                ..order.clone()
            };
            book.add_order(&resting);
        }

        Ok(trades)
    }

    /// Match a market order against the book. The full quantity must fill; a
    /// partial fill is rejected and any matched quantity is reported only when
    /// the order completes.
    fn submit_market(&self, order: &Order) -> Result<Vec<Trade>, MatchingError> {
        let opposite_is_bids = !order.is_buy();
        let mut trades = Vec::new();
        let mut remaining = order.remaining();

        let mut order_books = self.order_books.write().unwrap();
        let book = match order_books.get_mut(&order.market) {
            Some(b) => b,
            None => return Err(MatchingError::InvalidOrder("Market not found".to_string())),
        };

        loop {
            if remaining <= 1e-12 {
                break;
            }
            let key = if opposite_is_bids {
                match book.bids.keys().next_back() {
                    Some(k) => *k,
                    None => break,
                }
            } else {
                match book.asks.keys().next() {
                    Some(k) => *k,
                    None => break,
                }
            };
            let maker_price = f64::from_bits(key);
            let level = if opposite_is_bids {
                book.bids.get_mut(&key).unwrap()
            } else {
                book.asks.get_mut(&key).unwrap()
            };
            let mut level_remaining = remaining;
            let fills = drain_level(level, &mut level_remaining);
            let taken = remaining - level_remaining;
            remaining = level_remaining;
            let (maker_user, maker_order_id) = fills
                .first()
                .map(|f| (f.1.clone(), f.0.clone()))
                .unwrap_or_default();
            if taken > 0.0 {
                let (bid_user, ask_user) = if order.is_buy() {
                    (order.user_id.clone(), maker_user)
                } else {
                    (maker_user, order.user_id.clone())
                };
                trades.push(Trade::new(
                    format!("trade_{}", generate_id()),
                    maker_order_id,
                    order.market.clone(),
                    order.side,
                    maker_price,
                    taken,
                    bid_user,
                    ask_user,
                ));
            }
            let empty = if opposite_is_bids {
                book.bids.get(&key).map(|l| l.orders.is_empty()).unwrap_or(true)
            } else {
                book.asks.get(&key).map(|l| l.orders.is_empty()).unwrap_or(true)
            };
            if empty {
                if opposite_is_bids {
                    book.bids.remove(&key);
                } else {
                    book.asks.remove(&key);
                }
            }
        }

        if remaining > 1e-12 {
            self.remove_order_record(&order.id);
            return Err(MatchingError::InsufficientLiquidity(format!(
                "{} unfilled",
                remaining
            )));
        }

        Ok(trades)
    }

    /// Cancel order
    pub fn cancel_order(&self, order_id: &str) -> Result<(), MatchingError> {
        let order = {
            let orders = self.orders.read().unwrap();
            match orders.get(order_id) {
                Some(o) => o.clone(),
                None => return Err(MatchingError::OrderNotFound(order_id.to_string())),
            }
        };

        // Remove from order book
        let mut order_books = self.order_books.write().unwrap();
        if let Some(book) = order_books.get_mut(&order.market) {
            book.remove_order(order_id, order.price, order.side);
        }

        // Update order status
        {
            let mut orders = self.orders.write().unwrap();
            if let Some(o) = orders.get_mut(order_id) {
                o.status = OrderStatus::Cancelled;
                o.updated_at = current_timestamp();
            }
        }

        Ok(())
    }

    /// Get order book depth
    pub fn get_order_book(&self, market_id: &str, limit: usize) -> Option<OrderBook> {
        let order_books = self.order_books.read().unwrap();
        let mut book = order_books.get(market_id).cloned()?;
        // Truncate to the requested number of price levels per side so the
        // depth snapshot sent to clients is bounded.
        while book.bids.len() > limit {
            let key = *book.bids.keys().next().unwrap();
            book.bids.remove(&key);
        }
        while book.asks.len() > limit {
            let key = *book.asks.keys().next_back().unwrap();
            book.asks.remove(&key);
        }
        Some(book)
    }

    /// Get recent trades
    pub fn get_recent_trades(&self, limit: usize) -> Vec<Trade> {
        let trades = self.trades.read().unwrap();
        trades.iter().rev().take(limit).cloned().collect()
    }

    /// Get stats
    pub fn get_stats(&self) -> EngineStats {
        self.stats.read().unwrap().clone()
    }

    /// Update mark prices
    pub fn update_mark_prices(&self, prices: HashMap<String, f64>) {
        let mut positions = self.positions.write().unwrap();
        for (market, price) in prices {
            for (_, pos) in positions.iter_mut() {
                if pos.market == market {
                    pos.update_mark_price(price);
                }
            }
        }
    }

    /// Liquidate positions
    pub fn liquidate_positions(&self) -> Vec<Position> {
        let mut liquidations = Vec::new();
        let mut positions = self.positions.write().unwrap();

        for (_, pos) in positions.iter_mut() {
            if pos.check_liquidation() {
                pos.status = OrderStatus::Cancelled;
                liquidations.push(pos.clone());
            }
        }

        liquidations
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn generate_id() -> u64 {
    let mut rng = rand::thread_rng();
    rng.gen::<u64>()
}

fn current_timestamp() -> i64 {
    Utc::now().timestamp_millis()
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_order_book() {
        let mut book = OrderBook::new("BTC/USDT".to_string());

        let buy_order = Order {
            id: "order_1".to_string(),
            user_id: "user_1".to_string(),
            market: "BTC/USDT".to_string(),
            side: Side::Buy,
            order_type: OrderType::Limit,
            time_in_force: TimeInForce::GTC,
            price: 45000.0,
            stop_price: 0.0,
            trailing_delta: 0.0,
            quantity: 1.0,
            filled_quantity: 0.0,
            iceberg_quantity: 0.0,
            display_quantity: 0.0,
            status: OrderStatus::New,
            client_order_id: "".to_string(),
            created_at: 0,
            updated_at: 0,
            expired_at: 0,
        };

        book.add_order(&buy_order);
        assert!(book.best_bid() > 0.0);
    }

    #[test]
    fn test_position() {
        let pos = Position::new(
            "user_1".to_string(),
            "BTC/USDT".to_string(),
            Side::Buy,
            1.0,
            45000.0,
            10,
        );

        assert!(pos.liquidation_price > 0.0);
        assert_eq!(pos.leverage, 10);
    }

    #[test]
    fn test_market_validation() {
        let market = Market::new("BTC".to_string(), "USDT".to_string());

        let valid_order = Order {
            id: "order_1".to_string(),
            user_id: "user_1".to_string(),
            market: "BTC/USDT".to_string(),
            side: Side::Buy,
            order_type: OrderType::Limit,
            time_in_force: TimeInForce::GTC,
            price: 45000.0,
            stop_price: 0.0,
            trailing_delta: 0.0,
            quantity: 1.0,
            filled_quantity: 0.0,
            iceberg_quantity: 0.0,
            display_quantity: 0.0,
            status: OrderStatus::New,
            client_order_id: "".to_string(),
            created_at: 0,
            updated_at: 0,
            expired_at: 0,
        };

        assert!(market.validate_order(&valid_order).is_ok());
    }

    fn limit_order(id: &str, user: &str, side: Side, price: f64, quantity: f64) -> Order {
        Order {
            id: id.to_string(),
            user_id: user.to_string(),
            market: "BTC/USDT".to_string(),
            side,
            order_type: OrderType::Limit,
            time_in_force: TimeInForce::GTC,
            price,
            stop_price: 0.0,
            trailing_delta: 0.0,
            quantity,
            filled_quantity: 0.0,
            iceberg_quantity: 0.0,
            display_quantity: 0.0,
            status: OrderStatus::New,
            client_order_id: String::new(),
            created_at: 0,
            updated_at: 0,
            expired_at: 0,
        }
    }

    fn engine_with_market() -> Arc<MatchingEngine> {
        let engine = MatchingEngine::new();
        engine.add_market(Market::new("BTC".to_string(), "USDT".to_string()));
        engine
    }

    #[test]
    fn best_price_is_the_true_best_not_insertion_order() {
        let mut book = OrderBook::new("BTC/USDT".to_string());
        book.add_order(&limit_order("a", "u1", Side::Buy, 100.0, 1.0));
        book.add_order(&limit_order("b", "u2", Side::Buy, 101.0, 1.0));
        book.add_order(&limit_order("c", "u3", Side::Buy, 99.0, 1.0));
        book.add_order(&limit_order("d", "u4", Side::Sell, 105.0, 1.0));
        book.add_order(&limit_order("e", "u5", Side::Sell, 103.0, 1.0));

        assert_eq!(book.best_bid(), 101.0);
        assert_eq!(book.best_ask(), 103.0);
    }

    #[test]
    fn resting_orders_do_not_cross_without_a_marketable_order() {
        let engine = engine_with_market();
        engine.place_order(limit_order("bid", "u1", Side::Buy, 100.0, 1.0)).unwrap();
        let trades = engine.place_order(limit_order("ask", "u2", Side::Sell, 101.0, 1.0)).unwrap();
        assert!(trades.is_empty(), "100 bid and 101 ask must not trade");
    }

    #[test]
    fn marketable_limit_takes_liquidity_at_maker_price() {
        let engine = engine_with_market();
        engine.place_order(limit_order("ask", "maker", Side::Sell, 100.0, 2.0)).unwrap();
        let trades = engine.place_order(limit_order("bid", "taker", Side::Buy, 101.0, 1.0)).unwrap();

        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].price, 100.0, "taker must get the maker price");
        assert_eq!(trades[0].quantity, 1.0);
        assert_eq!(trades[0].buyer_user_id, "taker");
        assert_eq!(trades[0].seller_user_id, "maker");
    }

    #[test]
    fn partial_fill_leaves_the_remainder_resting() {
        let engine = engine_with_market();
        engine.place_order(limit_order("ask", "maker", Side::Sell, 100.0, 1.0)).unwrap();
        let trades = engine.place_order(limit_order("bid", "taker", Side::Buy, 100.0, 3.0)).unwrap();

        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].quantity, 1.0);

        let book = engine.get_order_book("BTC/USDT", 10).unwrap();
        assert_eq!(book.best_bid(), 100.0);
        assert!((book.bids.values().next().unwrap().quantity - 2.0).abs() < 1e-9);
    }

    #[test]
    fn market_order_without_liquidity_is_rejected_not_rested() {
        let engine = engine_with_market();
        let mut market_order = limit_order("m1", "taker", Side::Buy, 100.0, 1.0);
        market_order.order_type = OrderType::Market;
        assert!(engine.place_order(market_order).is_err());
        assert!(engine.get_recent_trades(10).is_empty());
    }

    #[test]
    fn price_time_priority_fills_the_earlier_order_first() {
        let engine = engine_with_market();
        engine.place_order(limit_order("first", "u1", Side::Sell, 100.0, 1.0)).unwrap();
        engine.place_order(limit_order("second", "u2", Side::Sell, 100.0, 1.0)).unwrap();

        let trades = engine.place_order(limit_order("taker", "u3", Side::Buy, 100.0, 1.0)).unwrap();
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].seller_user_id, "u1", "earlier order must fill first");

        let trades = engine.place_order(limit_order("taker2", "u3", Side::Buy, 100.0, 1.0)).unwrap();
        assert_eq!(trades[0].seller_user_id, "u2");
    }

    #[test]
    fn non_positive_price_is_rejected() {
        let mut book = OrderBook::new("BTC/USDT".to_string());
        book.add_order(&limit_order("bad", "u1", Side::Buy, 0.0, 1.0));
        book.add_order(&limit_order("bad2", "u1", Side::Buy, -5.0, 1.0));
        assert_eq!(book.best_bid(), 0.0);
        assert!(book.bids.is_empty());
    }

    #[test]
    fn cancel_removes_the_order_from_the_book() {
        let engine = engine_with_market();
        engine.place_order(limit_order("bid", "u1", Side::Buy, 99.0, 1.0)).unwrap();
        engine.cancel_order("bid").unwrap();
        let book = engine.get_order_book("BTC/USDT", 10).unwrap();
        assert_eq!(book.best_bid(), 0.0);
        assert!(book.bids.is_empty());
    }
}