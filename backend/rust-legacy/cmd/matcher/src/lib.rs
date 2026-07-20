//! TigerEx Matching Engine - Ultra-Low Latency Rust Implementation
//! Converted from Go for production-grade performance (<100μs)
//!
//! WHY RUST FOR MATCHING:
//! - Memory safety: No GC pauses, predictable latency
//! - Zero-cost abstractions  
//! - Lock-free data structures available
//! - Deterministic execution time

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Order side enum
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

/// Order type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderType {
    Market,
    Limit,
    StopLoss,
    StopLimit,
}

/// Order status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderStatus {
    Pending,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

/// Order structure - minimal memory footprint
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

    pub fn remaining(&self) -> f64 {
        self.quantity - self.filled_quantity
    }

    pub fn is_filled(&self) -> bool {
        self.filled_quantity >= self.quantity
    }
    
    pub fn is_buy(&self) -> bool {
        self.side == Side::Buy
    }
}

/// Price level in order book
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
        self.total_quantity += order.quantity;
        self.orders.push(order);
    }

    pub fn remove_order(&mut self, order_id: &str) -> Option<Order> {
        if let Some(pos) = self.orders.iter().position(|o| o.id == order_id) {
            let order = self.orders.remove(pos);
            self.total_quantity -= order.quantity;
            Some(order)
        } else {
            None
        }
    }
}

/// Order book for a single symbol
#[derive(Debug, Clone)]
pub struct OrderBook {
    pub symbol: String,
    bids: HashMap<f64, PriceLevel>,
    asks: HashMap<f64, PriceLevel>,
    orders: HashMap<String, Order>,
}

impl OrderBook {
    pub fn new(symbol: &str) -> Self {
        Self {
            symbol: symbol.to_string(),
            bids: HashMap::new(),
            asks: HashMap::new(),
            orders: HashMap::new(),
        }
    }

    /// Add order to book
    pub fn add_order(&mut self, order: Order) -> Option<Trade> {
        let order_id = order.id.clone();
        self.orders.insert(order_id, order.clone());
        
        // Add to price level
        let level = if order.side == Side::Buy {
            self.bids.entry(order.price).or_insert_with(|| PriceLevel::new(order.price))
        } else {
            self.asks.entry(order.price).or_insert_with(|| PriceLevel::new(order.price))
        };
        
        level.add_order(order.clone());
        
        // Try to match
        self.try_match(&order)
    }

    /// Remove order from book
    pub fn cancel_order(&mut self, order_id: &str) -> Option<Order> {
        if let Some(order) = self.orders.remove(order_id) {
            let level = if order.side == Side::Buy {
                self.bids.get_mut(&order.price)
            } else {
                self.asks.get_mut(&order.price)
            };
            
            if let Some(level) = level {
                level.remove_order(order_id);
            }
            
            Some(order)
        } else {
            None
        }
    }

    /// Try to match executable orders
    fn try_match(&mut self, incoming: &Order) -> Option<Trade> {
        let (best_bids, best_asks) = if incoming.side == Side::Buy {
            (&mut self.bids, &mut self.asks)
        } else {
            (&mut self.asks, &mut self.bids)
        };

        // Find matching price levels - iterate sorted
        let mut sorted_bids: Vec<_> = best_bids.iter().collect();
        sorted_bids.sort_by(|a, b| {
            if incoming.side == Side::Buy {
                b.0.partial_cmp(&a.0).unwrap()
            } else {
                a.0.partial_cmp(&b.0).unwrap()
            }
        });

        for (_, level) in sorted_bids {
            let can_match = if incoming.side == Side::Buy {
                incoming.price >= level.price
            } else {
                incoming.price <= level.price
            };
            
            if can_match && level.total_quantity > 0.0 {
                let fill_price = level.price;
                let fill_qty = f64::min(incoming.remaining(), level.total_quantity);
                
                level.total_quantity -= fill_qty;
                
                return Some(Trade {
                    id: generate_trade_id(),
                    symbol: incoming.symbol.clone(),
                    maker_order_id: level.orders.first().map(|o| o.id.clone()).unwrap_or_default(),
                    taker_order_id: incoming.id.clone(),
                    price: fill_price,
                    quantity: fill_qty,
                    timestamp: current_timestamp(),
                });
            }
        }
        
        None
    }

    /// Get best bid
    pub fn best_bid(&self) -> Option<(f64, f64)> {
        self.bids
            .iter()
            .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(price, level)| (*price, level.total_quantity))
    }

    /// Get best ask  
    pub fn best_ask(&self) -> Option<(f64, f64)> {
        self.asks
            .iter()
            .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(price, level)| (*price, level.total_quantity))
    }

    /// Get spread
    pub fn spread(&self) -> Option<f64> {
        Some(self.best_ask()?.0 - self.best_bid()?.0)
    }

    /// Get order by ID
    pub fn get_order(&self, order_id: &str) -> Option<&Order> {
        self.orders.get(order_id)
    }

    /// Get all open orders for user
    pub fn get_user_orders(&self, user_id: &str) -> Vec<&Order> {
        self.orders
            .values()
            .filter(|o| o.user_id == user_id && o.status == OrderStatus::Open)
            .collect()
    }
}

/// Trade - executed transaction
#[derive(Debug, Clone)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub maker_order_id: String,
    pub taker_order_id: String,
    pub price: f64,
    pub quantity: f64,
    pub timestamp: u64,
}

/// Level for order book view
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Level {
    pub price: f64,
    pub quantity: f64,
}

/// Order book depth response
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrderBookDepth {
    pub symbol: String,
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
}

impl OrderBook {
    /// Get order book depth
    pub fn depth(&self, levels: usize) -> OrderBookDepth {
        let mut bids: Vec<Level> = self.bids
            .iter()
            .take(levels)
            .map(|(p, l)| Level {
                price: *p,
                quantity: l.total_quantity,
            })
            .collect();

        let mut asks: Vec<Level> = self.asks
            .iter()
            .take(levels)
            .map(|(p, l)| Level {
                price: *p,
                quantity: l.total_quantity,
            })
            .collect();

        // Sort bids descending, asks ascending
        bids.sort_by(|a, b| b.price.partial_cmp(&a.price).unwrap_or(std::cmp::Ordering::Equal));
        asks.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap_or(std::cmp::Ordering::Equal));

        OrderBookDepth {
            symbol: self.symbol.clone(),
            bids,
            asks,
        }
    }
}

/// MatcherMetrics - performance tracking
#[derive(Debug, Default)]
pub struct MatcherMetrics {
    pub orders_processed: u64,
    pub trades_executed: u64,
}

/// Matcher - thread-safe order book manager
pub struct Matcher {
    books: RwLock<HashMap<String, OrderBook>>,
    metrics: RwLock<MatcherMetrics>,
}

impl Matcher {
    pub fn new() -> Self {
        Self {
            books: RwLock::new(HashMap::new()),
            metrics: RwLock::new(MatcherMetrics::default()),
        }
    }

    /// Get or create order book for symbol
    pub fn get_book(&self, symbol: &str) -> Arc<RwLock<OrderBook>> {
        let mut books = self.books.write().unwrap();
        if let Some(book) = books.get(symbol) {
            return Arc::new(RwLock::new(book.clone()));
        }
        
        let book = OrderBook::new(symbol);
        let arc = Arc::new(RwLock::new(book.clone()));
        books.insert(symbol.to_string(), book);
        arc
    }

    /// Add order - main entry point
    pub fn add_order(&self, order: Order) -> Option<Trade> {
        let book = self.get_book(&order.symbol);
        let mut book = book.write().unwrap();
        let trade = book.add_order(order);
        
        // Metrics
        let mut metrics = self.metrics.write().unwrap();
        metrics.orders_processed += 1;
        if trade.is_some() {
            metrics.trades_executed += 1;
        }
        
        trade
    }

    /// Cancel order
    pub fn cancel_order(&self, symbol: &str, order_id: &str) -> Option<Order> {
        let book = self.get_book(symbol);
        let mut book = book.write().unwrap();
        book.cancel_order(order_id)
    }

    /// Get depth
    pub fn depth(&self, symbol: &str, levels: usize) -> OrderBookDepth {
        let book = self.get_book(symbol);
        let book = book.read().unwrap();
        book.depth(levels)
    }

    /// Get metrics
    pub fn metrics(&self) -> MatcherMetrics {
        self.metrics.read().unwrap().clone()
    }
}

impl Default for OrderBook {
    fn default() -> Self {
        Self::new("DEFAULT")
    }
}

impl Default for Matcher {
    fn default() -> Self {
        Self::new()
    }
}

/// Helpers
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn generate_trade_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("trade_{:x}", ts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_order_book() {
        let mut book = OrderBook::new("BTC/USDT");
        
        let order = Order::new(
            "ord1".to_string(),
            "user1".to_string(),
            "BTC/USDT".to_string(),
            Side::Buy,
            50000.0,
            1.0,
        );
        
        book.add_order(order);
        
        assert!(book.best_bid().is_some());
    }
}