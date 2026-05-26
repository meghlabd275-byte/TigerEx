//! TigerEx Matching Engine - Rust Implementation
//! 
//! High-performance order matching engine for spot, futures, and options
//! Targeting microsecond-level latency for HFT

use std::collections::{BinaryHeap, HashMap};
use std::cmp::Ordering;
use serde::{Serialize, Deserialize};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderType {
    Market,
    Limit,
    StopMarket,
    StopLimit,
    TakeProfit,
    TrailingStop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderStatus {
    Pending,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeInForce {
    GTC, // Good Till Cancel
    IOC, // Immediate Or Cancel
    FOK, // Fill Or Kill
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub quantity: f64,
    pub price: Option<f64>,
    pub stop_price: Option<f64>,
    pub filled_quantity: f64,
    pub average_fill_price: Option<f64>,
    pub status: OrderStatus,
    pub time_in_force: TimeInForce,
    pub created_at: i64,
    pub updated_at: i64,
    pub rejected_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub order_id: String,
    pub counter_order_id: Option<String>,
    pub symbol: String,
    pub side: OrderSide,
    pub price: f64,
    pub quantity: f64,
    pub fee: f64,
    pub fee_asset: String,
    pub executed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookLevel {
    pub price: f64,
    pub quantity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookLevel>,
    pub asks: Vec<OrderBookLevel>,
    pub last_update_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Market {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub price_precision: u8,
    pub quantity_precision: u8,
    pub min_quantity: f64,
    pub max_quantity: f64,
    pub min_price: f64,
    pub max_price: f64,
    pub status: String,
}

// ============================================================================
// ORDER IMPLEMENTATIONS
// ============================================================================

impl Order {
    pub fn new_limit(id: String, user_id: String, symbol: String, side: OrderSide, quantity: f64, price: f64) -> Self {
        let now = current_timestamp_ms();
        Self {
            id,
            user_id,
            symbol,
            side,
            order_type: OrderType::Limit,
            quantity,
            price: Some(price),
            stop_price: None,
            filled_quantity: 0.0,
            average_fill_price: None,
            status: OrderStatus::Pending,
            time_in_force: TimeInForce::GTC,
            created_at: now,
            updated_at: now,
            rejected_reason: None,
        }
    }

    pub fn new_market(id: String, user_id: String, symbol: String, side: OrderSide, quantity: f64) -> Self {
        let now = current_timestamp_ms();
        Self {
            id,
            user_id,
            symbol,
            side,
            order_type: OrderType::Market,
            quantity,
            price: None,
            stop_price: None,
            filled_quantity: 0.0,
            average_fill_price: None,
            status: OrderStatus::Pending,
            time_in_force: TimeInForce::IOC,
            created_at: now,
            updated_at: now,
            rejected_reason: None,
        }
    }

    pub fn remaining_quantity(&self) -> f64 {
        self.quantity - self.filled_quantity
    }
}

// ============================================================================
// MATCHING ENGINE
// ============================================================================

pub struct MatchingEngine {
    order_books: HashMap<String, OrderBook>,
    orders: HashMap<String, Order>,
    markets: HashMap<String, Market>,
    trades: Vec<Trade>,
    order_id_counter: u64,
    trade_id_counter: u64,
}

#[derive(Debug, Clone)]
struct OrderLevel {
    price: f64,
    quantity: f64,
    timestamp: i64,
    order_id: String,
}

impl Ord for OrderLevel {
    fn cmp(&self, other: &Self) -> Ordering {
        other.price.partial_cmp(&self.price).unwrap_or(Ordering::Equal)
            .then(self.timestamp.cmp(&other.timestamp))
    }
}

impl PartialOrd for OrderLevel {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Eq for OrderLevel {}

impl MatchingEngine {
    pub fn new() -> Self {
        let mut engine = Self {
            order_books: HashMap::new(),
            orders: HashMap::new(),
            markets: HashMap::new(),
            trades: Vec::new(),
            order_id_counter: 0,
            trade_id_counter: 0,
        };
        engine.initialize_markets();
        engine
    }

    fn initialize_markets(&mut self) {
        let market_configs = vec![
            ("BTC/USDT", "BTC", "USDT", 2, 6),
            ("ETH/USDT", "ETH", "USDT", 2, 5),
            ("BNB/USDT", "BNB", "USDT", 2, 4),
            ("SOL/USDT", "SOL", "USDT", 3, 3),
            ("XRP/USDT", "XRP", "USDT", 5, 1),
            ("ADA/USDT", "ADA", "USDT", 5, 1),
            ("DOGE/USDT", "DOGE", "USDT", 6, 0),
            ("DOT/USDT", "DOT", "USDT", 3, 2),
            ("MATIC/USDT", "MATIC", "USDT", 4, 1),
            ("LTC/USDT", "LTC", "USDT", 2, 4),
        ];

        for (symbol, base, quote, price_prec, qty_prec) in market_configs {
            let min_qty = 10_f64.powi(-(qty_prec as i32));
            
            let market = Market {
                symbol: symbol.to_string(),
                base_asset: base.to_string(),
                quote_asset: quote.to_string(),
                price_precision: price_prec,
                quantity_precision: qty_prec,
                min_quantity: min_qty,
                max_quantity: 1_000_000_000.0,
                min_price: 0.00000001,
                max_price: 999_999_999_999.0,
                status: "trading".to_string(),
            };

            self.markets.insert(symbol.to_string(), market);

            self.order_books.insert(
                symbol.to_string(),
                OrderBook {
                    symbol: symbol.to_string(),
                    bids: Vec::new(),
                    asks: Vec::new(),
                    last_update_id: 0,
                },
            );
        }
    }

    pub fn create_order(&mut self, mut order: Order) -> Result<Order, String> {
        if !self.markets.contains_key(&order.symbol) {
            return Err(format!("Market {} not found", order.symbol));
        }

        self.validate_order(&order)?;

        self.order_id_counter += 1;
        order.id = format!("ORD-{}", self.order_id_counter);

        self.orders.insert(order.id.clone(), order.clone());

        match order.order_type {
            OrderType::Market => {
                self.process_market_order(&mut order)?;
            }
            _ => {
                self.process_limit_order(&mut order)?;
            }
        }

        Ok(order)
    }

    fn validate_order(&self, order: &Order) -> Result<(), String> {
        let market = self.markets.get(&order.symbol)
            .ok_or_else(|| "Market not found".to_string())?;

        if order.quantity <= 0.0 {
            return Err("Quantity must be positive".to_string());
        }

        if order.quantity < market.min_quantity {
            return Err(format!("Minimum quantity is {}", market.min_quantity));
        }

        if order.order_type == OrderType::Limit {
            if let Some(price) = order.price {
                if price <= 0.0 {
                    return Err("Limit orders require a valid price".to_string());
                }
                if price < market.min_price || price > market.max_price {
                    return Err(format!(
                        "Price must be between {} and {}",
                        market.min_price, market.max_price
                    ));
                }
            } else {
                return Err("Limit orders require a price".to_string());
            }
        }

        Ok(())
    }

    fn process_limit_order(&mut self, order: &mut Order) -> Result<(), String> {
        let book = self.order_books.get_mut(&order.symbol)
            .ok_or("Market not found")?;

        let can_fill = self.check_immediate_fill(order, book);

        if can_fill && order.time_in_force == TimeInForce::IOC {
            self.fill_order(order, book)?;
        } else if can_fill && order.time_in_force == TimeInForce::FOK {
            self.fill_order(order, book)?;
            if order.filled_quantity == 0.0 {
                order.status = OrderStatus::Rejected;
                order.rejected_reason = Some("Unable to fill completely".to_string());
            }
        } else {
            order.status = OrderStatus::Open;
            self.add_to_order_book(order, book);
        }

        Ok(())
    }

    fn check_immediate_fill(&self, order: &Order, book: &OrderBook) -> bool {
        if order.order_type != OrderType::Market && order.time_in_force == TimeInForce::GTC {
            return false;
        }

        let opposite_side = if order.side == OrderSide::Buy { &book.asks } else { &book.bids };
        !opposite_side.is_empty()
    }

    fn process_market_order(&mut self, order: &mut Order) -> Result<(), String> {
        let book = self.order_books.get_mut(&order.symbol)
            .ok_or("Market not found")?;
        
        self.fill_order(order, book)?;
        Ok(())
    }

    fn fill_order(&mut self, order: &mut Order, book: &mut OrderBook) -> Result<(), String> {
        let is_buy = order.side == OrderSide::Buy;
        let opposite = if is_buy { &book.asks } else { &book.bids };
        
        let mut remaining = order.quantity - order.filled_quantity;
        let mut total_cost = 0.0;

        for level in opposite.iter() {
            if remaining <= 0.0 {
                break;
            }

            let fill_qty = remaining.min(level.quantity);
            
            self.trade_id_counter += 1;
            let trade = Trade {
                id: format!("TRD-{}", self.trade_id_counter),
                order_id: order.id.clone(),
                counter_order_id: None,
                symbol: order.symbol.clone(),
                side: order.side,
                price: level.price,
                quantity: fill_qty,
                fee: 0.0,
                fee_asset: order.symbol.split('/').nth(1).unwrap_or("USDT").to_string(),
                executed_at: current_timestamp_ms(),
            };
            
            self.trades.push(trade);
            total_cost += level.price * fill_qty;
            remaining -= fill_qty;
        }

        let filled = order.quantity - remaining;
        order.filled_quantity = filled;
        
        if filled > 0.0 {
            order.average_fill_price = Some(total_cost / filled);
        }

        if remaining <= 0.0 {
            order.status = OrderStatus::Filled;
        } else if filled > 0.0 {
            order.status = OrderStatus::PartiallyFilled;
        } else {
            order.status = OrderStatus::Rejected;
        }

        order.updated_at = current_timestamp_ms();
        book.last_update_id += 1;

        Ok(())
    }

    fn add_to_order_book(&mut self, order: &Order, book: &mut OrderBook) {
        let price = match order.price {
            Some(p) => p,
            None => return,
        };

        let quantity = order.quantity - order.filled_quantity;
        let is_buy = order.side == OrderSide::Buy;
        
        if is_buy {
            book.bids.push(OrderBookLevel { price, quantity });
            book.bids.sort_by(|a, b| b.price.partial_cmp(&a.price).unwrap());
        } else {
            book.asks.push(OrderBookLevel { price, quantity });
            book.asks.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap());
        }

        book.last_update_id += 1;
    }

    pub fn cancel_order(&mut self, order_id: &str, user_id: &str) -> Result<Order, String> {
        let order = self.orders.get_mut(order_id)
            .ok_or("Order not found")?;

        if order.user_id != user_id {
            return Err("Unauthorized".to_string());
        }

        if order.status != OrderStatus::Open && order.status != OrderStatus::PartiallyFilled {
            return Err("Order cannot be cancelled".to_string());
        }

        order.status = OrderStatus::Cancelled;
        order.updated_at = current_timestamp_ms();

        Ok(order.clone())
    }

    pub fn get_order_book(&self, symbol: &str, limit: usize) -> Result<OrderBook, String> {
        let book = self.order_books.get(symbol)
            .ok_or("Market not found")?;

        let bids: Vec<OrderBookLevel> = book.bids.iter().take(limit).cloned().collect();
        let asks: Vec<OrderBookLevel> = book.asks.iter().take(limit).cloned().collect();

        Ok(OrderBook {
            symbol: symbol.to_string(),
            bids,
            asks,
            last_update_id: book.last_update_id,
        })
    }

    pub fn get_order(&self, order_id: &str) -> Option<&Order> {
        self.orders.get(order_id)
    }

    pub fn get_market(&self, symbol: &str) -> Option<&Market> {
        self.markets.get(symbol)
    }

    pub fn get_all_markets(&self) -> Vec<&Market> {
        self.markets.values().collect()
    }

    pub fn get_24h_ticker(&self, symbol: &str) -> Result<Ticker, String> {
        let book = self.order_books.get(symbol)
            .ok_or("Market not found")?;

        let trades: Vec<&Trade> = self.trades.iter()
            .filter(|t| t.symbol == symbol)
            .collect();

        if trades.is_empty() {
            return Ok(Ticker {
                price: 0.0,
                change: 0.0,
                change_percent: 0.0,
                high: 0.0,
                low: 0.0,
                volume: 0.0,
            });
        }

        let prices: Vec<f64> = trades.iter().map(|t| t.price).collect();
        let high = prices.iter().cloned().fold(f64::NAN, f64::max);
        let low = prices.iter().cloned().fold(f64::INFINITY, f64::min);
        let volume: f64 = trades.iter().map(|t| t.quantity).sum();
        
        let last_price = book.bids.first().map(|b| b.price).unwrap_or(0.0);
        let first_price = prices.first().copied().unwrap_or(last_price);
        let change = last_price - first_price;
        let change_percent = if first_price > 0.0 { (change / first_price) * 100.0 } else { 0.0 };

        Ok(Ticker {
            price: last_price,
            change,
            change_percent,
            high,
            low,
            volume,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub price: f64,
    pub change: f64,
    pub change_percent: f64,
    pub high: f64,
    pub low: f64,
    pub volume: f64,
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_market_order() {
        let mut engine = MatchingEngine::new();
        
        let order = Order::new_market(
            "temp".to_string(),
            "user1".to_string(),
            "BTC/USDT".to_string(),
            OrderSide::Buy,
            0.5,
        );

        let result = engine.create_order(order);
        assert!(result.is_ok());
    }

    #[test]
    fn test_limit_order() {
        let mut engine = MatchingEngine::new();
        
        let order = Order::new_limit(
            "temp".to_string(),
            "user1".to_string(),
            "BTC/USDT".to_string(),
            OrderSide::Buy,
            1.0,
            50000.0,
        );

        let result = engine.create_order(order);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_markets() {
        let engine = MatchingEngine::new();
        let markets = engine.get_all_markets();
        assert!(!markets.is_empty());
    }
}