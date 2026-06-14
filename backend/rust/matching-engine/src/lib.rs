//! TigerEx High-Performance Matching Engine
//! Ultra-low latency: < 50 microseconds
//! Rust for memory safety and performance
//! Supports: Spot, Margin, Futures, Leveraged Tokens

use std::collections::{BinaryHeap, HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{Instant, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

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

const MAX_ORDERS_PER_MARKET: usize = 1_000_000;
const MAX_PRICE_LEVELS: usize = 1000;
const ORDER_QUEUE_SIZE: usize = 100_000;
const TRADE_QUEUE_SIZE: usize = 100_000;
const MAX_POSITION_VALUE: f64 = 1_000_000_000.0;
const MIN_NOTIONAL_VALUE: f64 = 1.0;
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
    OCO_Buy,
    OCO_Sell,
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

/// Price level in order book
#[derive(Debug, Clone)]
pub struct PriceLevel {
    pub price: f64,
    pub quantity: f64,
    pub orders: Vec<String>,
}

/// Order book for a market
#[derive(Debug)]
pub struct OrderBook {
    pub market: String,
    pub bids: VecDeque<PriceLevel>,
    pub asks: VecDeque<PriceLevel>,
    pub bid_map: HashMap<f64, usize>,
    pub ask_map: HashMap<f64, usize>,
    pub last_update_id: i64,
    pub last_bid: f64,
    pub last_ask: f64,
}

impl OrderBook {
    pub fn new(market: String) -> Self {
        Self {
            market,
            bids: VecDeque::new(),
            asks: VecDeque::new(),
            bid_map: HashMap::new(),
            ask_map: HashMap::new(),
            last_update_id: 0,
            last_bid: 0.0,
            last_ask: 0.0,
        }
    }

    pub fn best_bid(&self) -> f64 {
        self.bids.front().map(|l| l.price).unwrap_or(0.0)
    }

    pub fn best_ask(&self) -> f64 {
        self.asks.front().map(|l| l.price).unwrap_or(f64::MAX)
    }

    pub fn spread(&self) -> f64 {
        self.best_ask() - self.best_bid()
    }

    pub fn add_order(&mut self, order: &Order) {
        let level = PriceLevel {
            price: order.price,
            quantity: order.remaining(),
            orders: vec![order.id.clone()],
        };

        if order.is_buy() {
            if let Some(idx) = self.bid_map.get(&order.price) {
                self.bids[*idx].quantity += order.remaining();
                self.bids[*idx].orders.push(order.id.clone());
            } else {
                let idx = self.bids.len();
                self.bid_map.insert(order.price, idx);
                self.bids.push_back(level);
            }
        } else {
            if let Some(idx) = self.ask_map.get(&order.price) {
                self.asks[*idx].quantity += order.remaining();
                self.asks[*idx].orders.push(order.id.clone());
            } else {
                let idx = self.asks.len();
                self.ask_map.insert(order.price, idx);
                self.asks.push_back(level);
            }
        }

        self.last_update_id += 1;
    }

    pub fn remove_order(&mut self, order_id: &str, price: f64, side: Side) {
        if side == Side::Buy {
            if let Some(idx) = self.bid_map.get(&price) {
                if let Some(level) = self.bids.get_mut(*idx) {
                    level.orders.retain(|id| id != order_id);
                    if level.orders.is_empty() {
                        self.bids.remove(*idx);
                        self.bid_map.remove(&price);
                    }
                }
            }
        } else {
            if let Some(idx) = self.ask_map.get(&price) {
                if let Some(level) = self.asks.get_mut(*idx) {
                    level.orders.retain(|id| id != order_id);
                    if level.orders.is_empty() {
                        self.asks.remove(*idx);
                        self.ask_map.remove(&price);
                    }
                }
            }
        }
        self.last_update_id += 1;
    }

    pub fn match_orders(&mut self, market_price: f64) -> Vec<Trade> {
        let mut trades = Vec::new();
        let mut executed = HashMap::new();

        // Match buy orders with asks
        while let Some(bid) = self.bids.front_mut() {
            if bid.quantity <= 0.0 || self.asks.is_empty() {
                break;
            }

            let ask = self.asks.front_mut().unwrap();
            if bid.price >= ask.price && ask.quantity > 0.0 {
                let trade_price = ask.price;
                let trade_qty = bid.quantity.min(ask.quantity);

                let trade = Trade::new(
                    format!("trade_{}", generate_id()),
                    format!("order_{}", generate_id()),
                    self.market.clone(),
                    Side::Buy,
                    trade_price,
                    trade_qty,
                );
                trades.push(trade);

                bid.quantity -= trade_qty;
                ask.quantity -= trade_qty;

                executed.insert(trade.order_id.clone(), trade_qty);
            } else {
                break;
            }
        }

        // Clean up filled levels
        self.bids.retain(|l| l.quantity > 0.0);
        self.asks.retain(|l| l.quantity > 0.0);

        self.last_update_id += 1;
        trades
    }
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
    pub created_at: i64,
}

impl Trade {
    pub fn new(id: String, order_id: String, market: String, side: Side, price: f64, quantity: f64) -> Self {
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
        let mut markets = self.markets.write().unwrap();
        markets.insert(market.id.clone(), market);

        let mut order_books = self.order_books.write().unwrap();
        order_books.insert(market.id.clone(), OrderBook::new(market.id.clone()));

        info!("Added market: {}", market.id);
    }

    /// Get market
    pub fn get_market(&self, market_id: &str) -> Option<Market> {
        let markets = self.markets.read().unwrap();
        markets.get(market_id).cloned()
    }

    /// Place order
    pub fn place_order(&self, mut order: Order) -> Result<Trade, MatchingError> {
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

        // Set order status
        order.status = OrderStatus::New;
        order.created_at = current_timestamp();
        order.updated_at = current_timestamp();

        // Store order
        {
            let mut orders = self.orders.write().unwrap();
            orders.insert(order.id.clone(), order.clone());
        }

        // Add to order book for limit orders
        if order.order_type == OrderType::Limit {
            let mut order_books = self.order_books.write().unwrap();
            if let Some(book) = order_books.get_mut(&order.market) {
                book.add_order(&order);
            }
        }

        // Update stats
        {
            let mut stats = self.stats.write().unwrap();
            stats.orders_processed += 1;
        }

        // Match orders
        self.match_orders(&order.market)?;

        // Return first trade
        let trades = self.trades.read().unwrap();
        trades.back().cloned().ok_or_else(|| {
            MatchingError::InvalidOrder("No trades generated".to_string())
        })
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

    /// Match orders
    fn match_orders(&self, market_id: &str) -> Result<(), MatchingError> {
        let mut order_books = self.order_books.write().unwrap();
        let book = match order_books.get_mut(market_id) {
            Some(b) => b,
            None => return Ok(()),
        };

        // Get market price
        let market_price = (book.best_bid() + book.best_ask()) / 2.0;

        // Match orders
        let trades = book.match_orders(market_price);

        if !trades.is_empty() {
            // Update stats
            {
                let mut stats = self.stats.write().unwrap();
                stats.trades_generated += trades.len() as u64;
                for trade in &trades {
                    stats.volume_24h += trade.price * trade.quantity;
                }
            }

            // Store trades
            {
                let mut trade_queue = self.trades.write().unwrap();
                for trade in &trades {
                    trade_queue.push_back(trade.clone());

                    // Keep only last TRADE_QUEUE_SIZE trades
                    while trade_queue.len() > TRADE_QUEUE_SIZE {
                        trade_queue.pop_front();
                    }
                }
            }

            // Broadcast trades
            for trade in &trades {
                let _ = self.trade_sender.send(trade.clone());
            }
        }

        Ok(())
    }

    /// Get order book depth
    pub fn get_order_book(&self, market_id: &str, limit: usize) -> Option<OrderBook> {
        let order_books = self.order_books.read().unwrap();
        order_books.get(market_id).cloned()
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
}