//! TigerEx Core Matching Engine - Rust Implementation
//! 
//! High-performance matching engine for spot, futures, and options
//! Optimized for ultra-low latency (<100 microseconds)
//! 
//! Migration from TypeScript to Rust for Binance/Coinbase quality performance

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

// Order types matching TypeScript enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderType {
    Market,
    Limit,
    StopMarket,
    StopLimit,
    TakeProfit,
    TrailingStop,
}

impl Default for OrderType {
    fn default() -> Self {
        OrderType::Limit
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OrderStatus {
    Pending,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TimeInForce {
    GTC, // Good Till Cancel
    IOC,  // Immediate Or Cancel
    FOK,  // Fill Or Kill
}

impl Default for TimeInForce {
    fn default() -> Self {
        TimeInForce::GTC
    }
}

// Price-Quantity tuple for order book entries
type PriceLevel = (u64, u64); // Price scaled by 1e8, quantity
type OrderBookEntry = [u64; 2]; // [price, quantity]

#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub quantity: u64,
    pub price: Option<u64>,
    pub stop_price: Option<u64>,
    pub filled_quantity: u64,
    pub average_fill_price: Option<u64>,
    pub status: OrderStatus,
    pub time_in_force: TimeInForce,
    pub created_at: u64,
    pub updated_at: u64,
    // Optional fields
    pub rejected_reason: Option<String>,
}

impl Order {
    pub fn new(
        user_id: String,
        symbol: String,
        side: OrderSide,
        order_type: OrderType,
        quantity: u64,
        price: Option<u64>,
        time_in_force: TimeInForce,
    ) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        
        Order {
            id: String::new(),
            user_id,
            symbol,
            side,
            order_type,
            quantity,
            price,
            stop_price: None,
            filled_quantity: 0,
            average_fill_price: None,
            status: OrderStatus::Pending,
            time_in_force,
            created_at: now,
            updated_at: now,
            rejected_reason: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Trade {
    pub id: String,
    pub order_id: String,
    pub counter_order_id: Option<String>,
    pub symbol: String,
    pub side: OrderSide,
    pub price: u64,
    pub quantity: u64,
    pub fee: u64,
    pub fee_asset: String,
    pub executed_at: u64,
}

#[derive(Debug, Clone)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookEntry>,  // Sorted DESC by price
    pub asks: Vec<OrderBookEntry>, // Sorted ASC by price
    pub last_update_id: u64,
}

impl OrderBook {
    pub fn new(symbol: &str) -> Self {
        OrderBook {
            symbol: symbol.to_string(),
            bids: Vec::new(),
            asks: Vec::new(),
            last_update_id: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Market {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub price_precision: u32,
    pub quantity_precision: u32,
    pub min_quantity: u64,
    pub max_quantity: u64,
    pub min_price: u64,
    pub max_price: u64,
    pub status: MarketStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Trading,
    Halted,
    Pending,
}

/// Fee tier configuration
#[derive(Debug, Clone)]
pub struct FeeTier {
    pub volume: u64,
    pub maker: u64, // Scaled by 1e4 (0.0001 = 1)
    pub taker: u64,
}

/// Main Matching Engine
pub struct MatchingEngine {
    order_books: HashMap<String, OrderBook>,
    orders: HashMap<String, Order>,
    markets: HashMap<String, Market>,
    trades: VecDeque<Trade>,
    order_id_counter: u64,
    trade_id_counter: u64,
    fees: Vec<FeeTier>,
}

impl Default for MatchingEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl MatchingEngine {
    /// Create new matching engine
    pub fn new() -> Self {
        let mut engine = MatchingEngine {
            order_books: HashMap::new(),
            orders: HashMap::new(),
            markets: HashMap::new(),
            trades: VecDeque::with_capacity(100000),
            order_id_counter: 0,
            trade_id_counter: 0,
            fees: Vec::new(),
        };
        
        engine.initialize_markets();
        engine.initialize_fees();
        
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
            let min_qty = 10_u64.pow(qty_prec);
            
            let market = Market {
                symbol: symbol.to_string(),
                base_asset: base.to_string(),
                quote_asset: quote.to_string(),
                price_precision: price_prec,
                quantity_precision: qty_prec,
                min_quantity: min_qty,
                max_quantity: 1_000_000_000,
                min_price: 1,
                max_price: 999_999_999_999,
                status: MarketStatus::Trading,
            };
            
            self.markets.insert(symbol.to_string(), market);
            self.order_books.insert(symbol.to_string(), OrderBook::new(symbol));
        }
    }

    fn initialize_fees(&mut self) {
        let fee_tiers = vec![
            (0, 10, 10),         // 0.001
            (100000, 8, 8),     // 0.0008
            (1000000, 6, 6),    // 0.0006
            (10000000, 4, 5),   // 0.0004/0.0005
            (100000000, 0, 4),  // 0/0.0004
        ];
        
        for (volume, maker, taker) in fee_tiers {
            self.fees.push(FeeTier {
                volume,
                maker,
                taker,
            });
        }
    }

    /// Scale price based on precision
    fn scale_price(&self, price: f64, precision: u32) -> u64 {
        (price * 10_f64.powi(precision as i32)) as u64
    }

    /// Unscale price to decimal
    fn unscale_price(&self, scaled: u64, precision: u32) -> f64 {
        scaled as f64 / 10_f64.powi(precision as i32)
    }

    /// Create new order
    pub fn create_order(
        &mut self,
        user_id: String,
        symbol: String,
        side: OrderSide,
        order_type: OrderType,
        quantity: u64,
        price: Option<u64>,
        time_in_force: TimeInForce,
    ) -> Result<Order, String> {
        // Validate market exists
        let market = self.markets.get(&symbol)
            .ok_or_else(|| format!("Market {} not found", symbol))?;

        // Validate order
        self.validate_order(quantity, price, order_type, market)?;

        // Generate order ID
        self.order_id_counter += 1;
        let order_id = format!("ORD-{}", self.order_id_counter);

        // Create order
        let mut order = Order::new(
            user_id,
            symbol.clone(),
            side,
            order_type,
            quantity,
            price,
            time_in_force,
        );
        order.id = order_id.clone();
        
        self.orders.insert(order_id.clone(), order.clone());

        // Process order based on type
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

    fn validate_order(
        &self,
        quantity: u64,
        price: Option<u64>,
        order_type: OrderType,
        market: &Market,
    ) -> Result<(), String> {
        if quantity == 0 {
            return Err("Quantity must be positive".to_string());
        }
        
        if quantity < market.min_quantity {
            return Err(format!("Minimum quantity is {}", market.min_quantity));
        }
        
        if order_type == OrderType::Limit {
            let price = price.ok_or_else(|| "Limit orders require a valid price".to_string())?;
            
            if price < market.min_price || price > market.max_price {
                return Err(format!(
                    "Price must be between {} and {}",
                    market.min_price, market.max_price
                ));
            }
        }
        
        Ok(())
    }

    fn process_limit_order(&mut self, order: &mut Order) -> Result<(), String> {
        let book = self.order_books.get_mut(&order.symbol)
            .ok_or_else(|| "Order book not found".to_string())?;

        // Check immediate fill
        let can_fill = match order.order_type {
            OrderType::Market => true,
            OrderType::StopMarket | OrderType::StopLimit => false,
            _ => {
                let has_opposite = if order.side == OrderSide::Buy {
                    !book.asks.is_empty()
                } else {
                    !book.bids.is_empty()
                };
                has_opposite && order.time_in_force != TimeInForce::GTC
            }
        };

        if can_fill {
            match order.time_in_force {
                TimeInForce::IOC => {
                    self.fill_order(order, book)?;
                    order.status = if order.filled_quantity == 0 {
                        OrderStatus::Rejected
                    } else {
                        OrderStatus::PartiallyFilled
                    };
                }
                TimeInForce::FOK => {
                    self.fill_order(order, book)?;
                    if order.filled_quantity == 0 {
                        order.status = OrderStatus::Rejected;
                        order.rejected_reason = Some("Unable to fill completely".to_string());
                    }
                }
                _ => {}
            }
        } else {
            // Add to order book
            order.status = OrderStatus::Open;
            self.add_to_order_book(order, book);
        }

        Ok(())
    }

    fn process_market_order(&mut self, order: &mut Order) -> Result<(), String> {
        let book = self.order_books.get_mut(&order.symbol)
            .ok_or_else(|| "Order book not found".to_string())?;

        self.fill_order(order, book)?;

        Ok(())
    }

    fn fill_order(&mut self, order: &mut Order, book: &mut OrderBook) -> Result<(), String> {
        let is_buy = order.side == OrderSide::Buy;
        let opposite_book = if is_buy { &mut book.asks } else { &mut book.bids };
        
        // Sort appropriately
        if is_buy {
            opposite_book.sort_by_key(|x| x[0]);
        } else {
            opposite_book.sort_by(|a, b| b[0].cmp(&a[0]));
        }

        let mut remaining = order.quantity;
        let mut total_cost = 0u128;

        let mut i = 0;
        while i < opposite_book.len() && remaining > 0 {
            let (price, avai_qty) = (opposite_book[i][0], opposite_book[i][1]);
            let fill_qty = remaining.min(avai_qty);

            // Create trade
            self.trade_id_counter += 1;
            let trade = Trade {
                id: format!("TRD-{}", self.trade_id_counter),
                order_id: order.id.clone(),
                counter_order_id: None,
                symbol: order.symbol.clone(),
                side: order.side,
                price,
                quantity: fill_qty,
                fee: 0,
                fee_asset: order.symbol.split('/').nth(1).unwrap_or("USDT").to_string(),
                executed_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64,
            };

            // Store trade
            if self.trades.len() >= 100000 {
                self.trades.pop_front();
            }
            self.trades.push_back(trade);

            total_cost += (price as u128) * (fill_qty as u128);
            remaining -= fill_qty;

            // Update order book
            if fill_qty == avai_qty {
                opposite_book.remove(i);
            } else {
                opposite_book[i][1] -= fill_qty;
                i += 1;
            }

            // Update order
            order.filled_quantity += fill_qty;
            if order.filled_quantity > 0 {
                order.average_fill_price = Some(
                    (total_cost / order.filled_quantity as u128) as u64
                );
            }
        }

        // Update order status
        order.status = if remaining == 0 {
            OrderStatus::Filled
        } else if order.filled_quantity > 0 {
            OrderStatus::PartiallyFilled
        } else {
            OrderStatus::Rejected
        };

        order.updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        book.last_update_id += 1;

        Ok(())
    }

    fn add_to_order_book(&mut self, order: &Order, book: &mut OrderBook) {
        let price = match order.price {
            Some(p) => p,
            None => return,
        };
        
        let quantity = order.quantity - order.filled_quantity;
        
        let book_side = if order.side == OrderSide::Buy {
            &mut book.bids
        } else {
            &mut book.asks
        };

        // Find existing level
        if let Some(existing) = book_side.iter_mut().find(|x| x[0] == price) {
            existing[1] += quantity;
        } else {
            book_side.push([price, quantity]);
            
            // Sort
            if order.side == OrderSide::Buy {
                book_side.sort_by(|a, b| b[0].cmp(&a[0])); // Desc
            } else {
                book_side.sort_by_key(|x| x[0]); // Asc
            }
        }

        book.last_update_id += 1;
    }

    /// Cancel order
    pub fn cancel_order(&mut self, order_id: &str, user_id: &str) -> Result<Order, String> {
        let order = self.orders.get_mut(order_id)
            .ok_or_else(|| "Order not found".to_string())?;

        if order.user_id != user_id {
            return Err("Unauthorized".to_string());
        }

        if order.status != OrderStatus::Open && order.status != OrderStatus::PartiallyFilled {
            return Err("Order cannot be cancelled".to_string());
        }

        order.status = OrderStatus::Cancelled;
        order.updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        Ok(order.clone())
    }

    /// Get order book
    pub fn get_order_book(&self, symbol: &str, limit: usize) -> Result<OrderBook, String> {
        let book = self.order_books.get(symbol)
            .ok_or_else(|| "Market not found".to_string())?;

        let mut result = book.clone();
        result.bids.truncate(limit);
        result.asks.truncate(limit);

        Ok(result)
    }

    /// Get order
    pub fn get_order(&self, order_id: &str) -> Option<Order> {
        self.orders.get(order_id).cloned()
    }

    /// Get user trades
    pub fn get_user_trades(&self, user_id: &str, limit: usize) -> Vec<Trade> {
        self.trades
            .iter()
            .rev()
            .filter(|t| {
                self.orders.get(&t.order_id)
                    .map(|o| o.user_id == user_id)
                    .unwrap_or(false)
            })
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get market
    pub fn get_market(&self, symbol: &str) -> Option<&Market> {
        self.markets.get(symbol)
    }

    /// Get all markets
    pub fn get_all_markets(&self) -> Vec<&Market> {
        self.markets.values().collect()
    }

    /// Get current price
    pub fn get_current_price(&self, symbol: &str) -> Option<u64> {
        let book = self.order_books.get(symbol)?;
        if book.bids.is_empty() {
            None
        } else {
            Some(book.bids[0][0])
        }
    }

    /// Get 24h ticker
    pub fn get_24h_ticker(&self, symbol: &str) -> Option<Ticker> {
        let book = self.order_books.get(symbol)?;
        if !self.markets.contains_key(symbol) {
            return None;
        }

        let trades: Vec<_> = self.trades.iter()
            .filter(|t| t.symbol == symbol)
            .collect();

        if trades.is_empty() {
            return Some(Ticker {
                price: 0,
                change: 0,
                change_percent: 0.0,
                high: 0,
                low: 0,
                volume: 0,
            });
        }

        let prices: Vec<u64> = trades.iter().map(|t| t.price).collect();
        
        let high = *prices.iter().max().unwrap_or(&0);
        let low = *prices.iter().min().unwrap_or(&0);
        let volume: u64 = trades.iter().map(|t| t.quantity).sum();
        
        let last_price = book.bids.first().map(|b| b[0]).unwrap_or(0);
        let first_price = prices.first().copied().unwrap_or(last_price);
        
        let change = last_price as i64 - first_price as i64;
        let change_percent = if first_price > 0 {
            (change as f64 / first_price as f64) * 100.0
        } else {
            0.0
        };

        Some(Ticker {
            price: last_price,
            change,
            change_percent,
            high,
            low,
            volume,
        })
    }
}

#[derive(Debug, Clone)]
pub struct Ticker {
    pub price: i64,
    pub change: i64,
    pub change_percent: f64,
    pub high: u64,
    pub low: u64,
    pub volume: u64,
}

// Thread-safe wrapper for multi-threaded deployment
pub type SharedMatchingEngine = Arc<RwLock<MatchingEngine>>;

impl SharedMatchingEngine {
    pub fn new() -> Self {
        Arc::new(RwLock::new(MatchingEngine::new()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_order() {
        let mut engine = MatchingEngine::new();
        
        let order = engine.create_order(
            "user1".to_string(),
            "BTC/USDT".to_string(),
            OrderSide::Buy,
            OrderType::Limit,
            1000000, // 0.01 BTC with 8 precision
            Some(50000000), // 500 USDT
            TimeInForce::GTC,
        ).unwrap();
        
        assert_eq!(order.symbol, "BTC/USDT");
        assert_eq!(order.side, OrderSide::Buy);
    }

    #[test]
    fn test_order_book() {
        let engine = MatchingEngine::new();
        let book = engine.get_order_book("BTC/USDT", 10).unwrap();
        
        assert_eq!(book.symbol, "BTC/USDT");
    }
}