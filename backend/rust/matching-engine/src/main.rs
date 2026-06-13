//! TigerEx High-Performance Matching Engine
//! Ultra-low latency order matching system written in Rust
//! Target: < 100 microseconds order execution

use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::cmp::Ordering;

// ============================================================================
// Core Types
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderType {
    Market,
    Limit,
    StopLoss,
    StopLimit,
    OCO,
    TrailingStop,
    IOC,     // Immediate or Cancel
    FOK,     // Fill or Kill
    GTC,     // Good Till Cancel
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderStatus {
    New,
    PartialFilled,
    Filled,
    Cancelled,
    Rejected,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeInForce {
    GTC,  // Good Till Cancel
    IOC,   // Immediate or Cancel
    FOK,   // Fill or Kill
    GTD,   // Good Till Date
}

// ============================================================================
// Order Structure
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub order_id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub price: f64,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub remaining_quantity: f64,
    pub stop_price: Option<f64>,
    pub time_in_force: TimeInForce,
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub client_order_id: Option<String>,
    pub reduce_only: bool,
    pub post_only: bool,
    pub leverage: u32,
}

impl Order {
    pub fn new(
        user_id: String,
        symbol: String,
        side: OrderSide,
        order_type: OrderType,
        price: f64,
        quantity: f64,
    ) -> Self {
        let now = Utc::now();
        Self {
            order_id: Uuid::new_v4().to_string(),
            user_id,
            symbol,
            side,
            order_type,
            price,
            quantity,
            filled_quantity: 0.0,
            remaining_quantity: quantity,
            stop_price: None,
            time_in_force: TimeInForce::GTC,
            status: OrderStatus::New,
            created_at: now,
            updated_at: now,
            client_order_id: None,
            reduce_only: false,
            post_only: false,
            leverage: 1,
        }
    }

    pub fn is_buy(&self) -> bool {
        self.side == OrderSide::Buy
    }

    pub fn fill(&mut self, quantity: f64) {
        self.filled_quantity += quantity;
        self.remaining_quantity = self.quantity - self.filled_quantity;
        self.updated_at = Utc::now();
        
        if self.remaining_quantity <= 0.0 {
            self.status = OrderStatus::Filled;
        } else {
            self.status = OrderStatus::PartialFilled;
        }
    }

    pub fn cancel(&mut self) {
        self.status = OrderStatus::Cancelled;
        self.updated_at = Utc::now();
    }

    pub fn reject(&mut self) {
        self.status = OrderStatus::Rejected;
        self.updated_at = Utc::now();
    }
}

// ============================================================================
// Trade Structure
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub trade_id: String,
    pub order_id: String,
    pub counter_order_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub price: f64,
    pub quantity: f64,
    pub fee: f64,
    pub fee_token: String,
    pub executed_at: DateTime<Utc>,
    pub maker: bool,
}

impl Trade {
    pub fn new(
        order_id: String,
        counter_order_id: String,
        symbol: String,
        side: OrderSide,
        price: f64,
        quantity: f64,
        maker: bool,
    ) -> Self {
        Self {
            trade_id: Uuid::new_v4().to_string(),
            order_id,
            counter_order_id,
            symbol,
            side,
            price,
            quantity,
            fee: 0.0,
            fee_token: "USDT".to_string(),
            executed_at: Utc::now(),
            maker,
        }
    }
}

// ============================================================================
// Order Book - Price Level
// ============================================================================

#[derive(Debug, Clone)]
pub struct PriceLevel {
    pub price: f64,
    pub orders: Vec<Order>,
    pub total_quantity: f64,
}

impl PriceLevel {
    pub fn new(price: f64) -> Self {
        Self {
            price,
            orders: Vec::new(),
            total_quantity: 0.0,
        }
    }

    pub fn add_order(&mut self, order: Order) {
        self.total_quantity += order.remaining_quantity;
        self.orders.push(order);
    }

    pub fn remove_order(&mut self, order_id: &str) -> Option<Order> {
        if let Some(pos) = self.orders.iter().position(|o| o.order_id == order_id) {
            let order = self.orders.remove(pos);
            self.total_quantity -= order.remaining_quantity;
            return Some(order);
        }
        None
    }

    pub fn update_quantity(&mut self) {
        self.total_quantity = self.orders.iter().map(|o| o.remaining_quantity).sum();
    }
}

// ============================================================================
// Order Book
// ============================================================================

#[derive(Debug)]
pub struct OrderBook {
    pub symbol: String,
    bids: Vec<PriceLevel>,  // Buy orders - sorted by price desc
    asks: Vec<PriceLevel>,  // Sell orders - sorted by price asc
    pub orders: HashMap<String, Order>,
    last_price: f64,
    last_time: DateTime<Utc>,
}

impl OrderBook {
    pub fn new(symbol: String) -> Self {
        Self {
            symbol,
            bids: Vec::new(),
            asks: Vec::new(),
            orders: HashMap::new(),
            last_price: 0.0,
            last_time: Utc::now(),
        }
    }

    // Add order to book
    pub fn add_order(&mut self, order: Order) -> Vec<Trade> {
        let mut trades = Vec::new();
        
        // Store the order
        let order_id = order.order_id.clone();
        let side = order.side;
        let price = order.price;
        let quantity = order.remaining_quantity;

        // Match against opposite side
        match side {
            OrderSide::Buy => {
                trades = self.match_market(&order);
                if trades.is_empty() {
                    trades = self.match_limit_buy(&order);
                }
            }
            OrderSide::Sell => {
                trades = self.match_market(&order);
                if trades.is_empty() {
                    trades = self.match_limit_sell(&order);
                }
            }
        }

        // If order still has remaining quantity, add to book
        if let Some(remaining_order) = self.orders.get_mut(&order_id) {
            if remaining_order.remaining_quantity > 0.0 && remaining_order.status == OrderStatus::New {
                self.add_to_book(remaining_order.clone());
                remaining_order.status = OrderStatus::PartialFilled;
            }
        }

        if !trades.is_empty() {
            self.last_price = trades.last().unwrap().price;
            self.last_time = Utc::now();
        }

        trades
    }

    // Match market order
    fn match_market(&mut self, order: &Order) -> Vec<Trade> {
        let mut trades = Vec::new();
        
        match order.side {
            OrderSide::Buy => {
                // Match against lowest asks
                let mut remaining = order.remaining_quantity;
                while remaining > 0.0 && !self.asks.is_empty() {
                    if self.asks[0].total_quantity <= 0.0 {
                        self.asks.remove(0);
                        continue;
                    }

                    let ask_order = &self.asks[0].orders[0];
                    let fill_qty = remaining.min(ask_order.remaining_quantity);
                    
                    trades.push(Trade::new(
                        order.order_id.clone(),
                        ask_order.order_id.clone(),
                        self.symbol.clone(),
                        OrderSide::Buy,
                        ask_order.price,
                        fill_qty,
                        true, // ask is maker
                    ));

                    remaining -= fill_qty;

                    // Update ask order
                    if let Some(ask) = self.asks[0].orders.get_mut(0) {
                        ask.fill(fill_qty);
                        if ask.status == OrderStatus::Filled {
                            self.asks[0].orders.remove(0);
                            self.asks[0].update_quantity();
                            if self.asks[0].orders.is_empty() {
                                self.asks.remove(0);
                            }
                        }
                    }
                }
            }
            OrderSide::Sell => {
                // Match against highest bids
                let mut remaining = order.remaining_quantity;
                while remaining > 0.0 && !self.bids.is_empty() {
                    if self.bids[0].total_quantity <= 0.0 {
                        self.bids.remove(0);
                        continue;
                    }

                    let bid_order = &self.bids[0].orders[0];
                    let fill_qty = remaining.min(bid_order.remaining_quantity);
                    
                    trades.push(Trade::new(
                        order.order_id.clone(),
                        bid_order.order_id.clone(),
                        self.symbol.clone(),
                        OrderSide::Sell,
                        bid_order.price,
                        fill_qty,
                        true, // bid is maker
                    ));

                    remaining -= fill_qty;

                    // Update bid order
                    if let Some(bid) = self.bids[0].orders.get_mut(0) {
                        bid.fill(fill_qty);
                        if bid.status == OrderStatus::Filled {
                            self.bids[0].orders.remove(0);
                            self.bids[0].update_quantity();
                            if self.bids[0].orders.is_empty() {
                                self.bids.remove(0);
                            }
                        }
                    }
                }
            }
        }

        // Update order in map
        if let Some(ord) = self.orders.get_mut(&order.order_id) {
            ord.fill(order.quantity - remaining);
        }

        trades
    }

    // Match limit buy order
    fn match_limit_buy(&mut self, order: &Order) -> Vec<Trade> {
        let mut trades = Vec::new();
        let mut remaining = order.remaining_quantity;

        while remaining > 0.0 && !self.asks.is_empty() {
            // Check if ask price <= order price
            if self.asks[0].price > order.price {
                break;
            }

            if self.asks[0].total_quantity <= 0.0 {
                self.asks.remove(0);
                continue;
            }

            let ask_order = &self.asks[0].orders[0];
            let fill_qty = remaining.min(ask_order.remaining_quantity);
            
            trades.push(Trade::new(
                order.order_id.clone(),
                ask_order.order_id.clone(),
                self.symbol.clone(),
                OrderSide::Buy,
                ask_order.price,
                fill_qty,
                true,
            ));

            remaining -= fill_qty;

            if let Some(ask) = self.asks[0].orders.get_mut(0) {
                ask.fill(fill_qty);
                if ask.status == OrderStatus::Filled {
                    self.asks[0].orders.remove(0);
                    self.asks[0].update_quantity();
                    if self.asks[0].orders.is_empty() {
                        self.asks.remove(0);
                    }
                }
            }
        }

        if let Some(ord) = self.orders.get_mut(&order.order_id) {
            ord.fill(order.quantity - remaining);
        }

        trades
    }

    // Match limit sell order
    fn match_limit_sell(&mut self, order: &Order) -> Vec<Trade> {
        let mut trades = Vec::new();
        let mut remaining = order.remaining_quantity;

        while remaining > 0.0 && !self.bids.is_empty() {
            // Check if bid price >= order price
            if self.bids[0].price < order.price {
                break;
            }

            if self.bids[0].total_quantity <= 0.0 {
                self.bids.remove(0);
                continue;
            }

            let bid_order = &self.bids[0].orders[0];
            let fill_qty = remaining.min(bid_order.remaining_quantity);
            
            trades.push(Trade::new(
                order.order_id.clone(),
                bid_order.order_id.clone(),
                self.symbol.clone(),
                OrderSide::Sell,
                bid_order.price,
                fill_qty,
                true,
            ));

            remaining -= fill_qty;

            if let Some(bid) = self.bids[0].orders.get_mut(0) {
                bid.fill(fill_qty);
                if bid.status == OrderStatus::Filled {
                    self.bids[0].orders.remove(0);
                    self.bids[0].update_quantity();
                    if self.bids[0].orders.is_empty() {
                        self.bids.remove(0);
                    }
                }
            }
        }

        if let Some(ord) = self.orders.get_mut(&order.order_id) {
            ord.fill(order.quantity - remaining);
        }

        trades
    }

    // Add order to book
    fn add_to_book(&mut self, order: Order) {
        match order.side {
            OrderSide::Buy => {
                self.insert_price_level(&mut self.bids, order);
            }
            OrderSide::Sell => {
                self.insert_price_level(&mut self.asks, order);
            }
        }
    }

    fn insert_price_level(&self, levels: &mut Vec<PriceLevel>, order: Order) {
        let price = order.price;
        
        if let Some(level) = levels.iter_mut().find(|l| (l.price - price).abs() < f64::EPSILON) {
            level.add_order(order);
        } else {
            let mut new_level = PriceLevel::new(price);
            new_level.add_order(order);
            
            match order.side {
                OrderSide::Buy => {
                    levels.push(new_level);
                    levels.sort_by(|a, b| b.price.partial_cmp(&a.price).unwrap_or(Ordering::Equal));
                }
                OrderSide::Sell => {
                    levels.push(new_level);
                    levels.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap_or(Ordering::Equal));
                }
            }
        }
    }

    // Cancel order
    pub fn cancel_order(&mut self, order_id: &str) -> Option<Order> {
        if let Some(order) = self.orders.remove(order_id) {
            match order.side {
                OrderSide::Buy => {
                    if let Some(level) = self.bids.iter_mut().find(|l| {
                        l.orders.iter().any(|o| o.order_id == order_id)
                    }) {
                        level.remove_order(order_id);
                        level.update_quantity();
                        if level.orders.is_empty() {
                            self.bids.retain(|l| l.price != level.price);
                        }
                    }
                }
                OrderSide::Sell => {
                    if let Some(level) = self.asks.iter_mut().find(|l| {
                        l.orders.iter().any(|o| o.order_id == order_id)
                    }) {
                        level.remove_order(order_id);
                        level.update_quantity();
                        if level.orders.is_empty() {
                            self.asks.retain(|l| l.price != level.price);
                        }
                    }
                }
            }
            return Some(order);
        }
        None
    }

    // Get order
    pub fn get_order(&self, order_id: &str) -> Option<&Order> {
        self.orders.get(order_id)
    }

    // Get best bid/ask
    pub fn get_best_bid(&self) -> Option<(f64, f64)> {
        self.bids.first().map(|l| (l.price, l.total_quantity))
    }

    pub fn get_best_ask(&self) -> Option<(f64, f64)> {
        self.asks.first().map(|l| (l.price, l.total_quantity))
    }

    // Get market depth
    pub fn get_depth(&self, levels: usize) -> (Vec<(f64, f64)>, Vec<(f64, f64)>) {
        let bids: Vec<(f64, f64)> = self.bids.iter()
            .take(levels)
            .map(|l| (l.price, l.total_quantity))
            .collect();
        
        let asks: Vec<(f64, f64)> = self.asks.iter()
            .take(levels)
            .map(|l| (l.price, l.total_quantity))
            .collect();
        
        (bids, asks)
    }

    // Get spread
    pub fn get_spread(&self) -> Option<f64> {
        match (self.get_best_bid(), self.get_best_ask()) {
            (Some((bid, _)), (Some((ask, _))) => Some(ask - bid),
            _ => None,
        }
    }
}

// ============================================================================
// Matching Engine
// ============================================================================

pub struct MatchingEngine {
    order_books: RwLock<HashMap<String, OrderBook>>,
    config: EngineConfig,
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub max_price_deviation: f64,
    pub price_precision: u32,
    pub quantity_precision: u32,
    pub max_orders_per_symbol: usize,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            max_price_deviation: 0.1,
            price_precision: 8,
            quantity_precision: 8,
            max_orders_per_symbol: 1_000_000,
        }
    }
}

impl MatchingEngine {
    pub fn new(config: EngineConfig) -> Self {
        Self {
            order_books: RwLock::new(HashMap::new()),
            config,
        }
    }

    pub fn with_symbol(mut self, symbol: &str) -> Self {
        let mut books = self.order_books.write();
        books.insert(symbol.to_string(), OrderBook::new(symbol.to_string()));
        self
    }

    // Process order
    pub fn process_order(&self, order: Order) -> Result<Vec<Trade>, EngineError> {
        let symbol = order.symbol.clone();
        
        // Get or create order book
        let mut books = self.order_books.write();
        let order_book = books.entry(symbol.clone()).or_insert_with(|| OrderBook::new(symbol));
        
        // Validate order
        if order.quantity <= 0.0 {
            return Err(EngineError::InvalidQuantity);
        }
        
        if order.price <= 0.0 && order.order_type != OrderType::Market {
            return Err(EngineError::InvalidPrice);
        }

        // Store order
        let order_id = order.order_id.clone();
        order_book.orders.insert(order_id.clone(), order);

        // Get order for processing
        let mut proc_order = match order_book.orders.get(&order_id) {
            Some(o) => o.clone(),
            None => return Err(EngineError::OrderNotFound),
        };

        // Validate price deviation for limit orders
        if let OrderType::Limit = proc_order.order_type {
            if let Some((best_bid, _)) = order_book.get_best_bid() {
                let deviation = (proc_order.price - best_bid) / best_bid;
                if deviation.abs() > self.config.max_price_deviation {
                    proc_order.reject();
                    order_book.orders.insert(order_id, proc_order);
                    return Err(EngineError::PriceDeviationTooHigh);
                }
            }
        }

        // Process order
        let trades = order_book.add_order(proc_order.clone());
        
        // Update order in book
        if let Some(o) = order_book.orders.get_mut(&order_id) {
            *o = proc_order;
        }

        Ok(trades)
    }

    // Cancel order
    pub fn cancel_order(&self, symbol: &str, order_id: &str) -> Result<Order, EngineError> {
        let mut books = self.order_books.write();
        
        let order_book = books.get_mut(symbol)
            .ok_or(EngineError::SymbolNotFound)?;
        
        order_book.cancel_order(order_id)
            .ok_or(EngineError::OrderNotFound)
    }

    // Get order book depth
    pub fn get_depth(&self, symbol: &str, levels: usize) -> Result<(Vec<(f64, f64)>, Vec<(f64, f64)>), EngineError> {
        let books = self.order_books.read();
        
        let order_book = books.get(symbol)
            .ok_or(EngineError::SymbolNotFound)?;
        
        Ok(order_book.get_depth(levels))
    }

    // Get ticker
    pub fn get_ticker(&self, symbol: &str) -> Result<Ticker, EngineError> {
        let books = self.order_books.read();
        
        let order_book = books.get(symbol)
            .ok_or(EngineError::SymbolNotFound)?;
        
        let (bid, bid_qty) = order_book.get_best_bid().unwrap_or((0.0, 0.0));
        let (ask, ask_qty) = order_book.get_best_ask().unwrap_or((0.0, 0.0));
        
        Ok(Ticker {
            symbol: symbol.to_string(),
            last_price: order_book.last_price,
            bid_price: bid,
            ask_price: ask,
            bid_quantity: bid_qty,
            ask_quantity: ask_qty,
            volume_24h: 0.0,
            high_24h: 0.0,
            low_24h: 0.0,
            change_24h: 0.0,
        })
    }
}

// ============================================================================
// Ticker
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub symbol: String,
    pub last_price: f64,
    pub bid_price: f64,
    pub ask_price: f64,
    pub bid_quantity: f64,
    pub ask_quantity: f64,
    pub volume_24h: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub change_24h: f64,
}

// ============================================================================
// Errors
// ============================================================================

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("Invalid quantity")]
    InvalidQuantity,
    
    #[error("Invalid price")]
    InvalidPrice,
    
    #[error("Order not found")]
    OrderNotFound,
    
    #[error("Symbol not found")]
    SymbolNotFound,
    
    #[error("Price deviation too high")]
    PriceDeviationTooHigh,
    
    #[error("Insufficient liquidity")]
    InsufficientLiquidity,
    
    #[error("Order would match against self")]
    SelfTrade,
}

// ============================================================================
// Main entry point
// ============================================================================

fn main() {
    tracing_subscriber::fmt::init();

    tracing::info!("TigerEx Matching Engine starting...");

    let config = EngineConfig::default();
    let engine = MatchingEngine::new(config)
        .with_symbol("BTC-USDT")
        .with_symbol("ETH-USDT")
        .with_symbol("SOL-USDT");

    // Example: Place a buy limit order
    let order = Order::new(
        "user123".to_string(),
        "BTC-USDT".to_string(),
        OrderSide::Buy,
        OrderType::Limit,
        67000.0,
        1.0,
    );

    tracing::info!("Processing order: {:?}", order.order_id);

    match engine.process_order(order) {
        Ok(trades) => {
            tracing::info!("Order processed, {} trades executed", trades.len());
            for trade in &trades {
                tracing::info!("  Trade: {} @ {}", trade.quantity, trade.price);
            }
        }
        Err(e) => {
            tracing::error!("Order failed: {}", e);
        }
    }

    // Get depth
    if let Ok((bids, asks)) = engine.get_depth("BTC-USDT", 5) {
        tracing::info!("Order book depth - Bids: {:?}, Asks: {:?}", bids, asks);
    }

    // Get ticker
    if let Ok(ticker) = engine.get_ticker("BTC-USDT") {
        tracing::info!("Ticker: {:?}", ticker);
    }

    tracing::info!("TigerEx Matching Engine ready");
}