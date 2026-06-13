//! TigerEx Market Data Aggregator - Rust Implementation
//! 
//! High-performance market data aggregation and distribution
//! Processes order book updates, trades, candles, tickers
//! 
//! Migration from Go to Rust

use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

/// Market statistics
#[derive(Debug, Clone)]
pub struct MarketStats {
    pub symbol: String,
    pub last_price: u64,
    pub price_change: i64,
    pub price_change_percent: f64,
    pub high_24h: u64,
    pub low_24h: u64,
    pub volume_24h: u64,
    pub quote_volume_24h: u64,
    pub open_interest: u64,
    pub trades_24h: u64,
    pub timestamp_ms: u64,
}

impl MarketStats {
    pub fn new(symbol: &str) -> Self {
        MarketStats {
            symbol: symbol.to_string(),
            last_price: 0,
            price_change: 0,
            price_change_percent: 0.0,
            high_24h: 0,
            low_24h: 0,
            volume_24h: 0,
            quote_volume_24h: 0,
            open_interest: 0,
            trades_24h: 0,
            timestamp_ms: current_timestamp(),
        }
    }
    
    pub fn update(&mut self, price: u64, quantity: u64) {
        self.last_price = price;
        self.volume_24h += quantity;
        self.quote_volume_24h += price * quantity;
        self.trades_24h += 1;
        
        if self.high_24h == 0 || price > self.high_24h {
            self.high_24h = price;
        }
        if self.low_24h == 0 || price < self.low_24h {
            self.low_24h = price;
        }
        
        self.timestamp_ms = current_timestamp();
    }
    
    pub fn calculate_change(&mut self, open_price: u64) {
        if open_price > 0 {
            self.price_change = self.last_price as i64 - open_price as i64;
            self.price_change_percent = (self.price_change as f64 / open_price as f64) * 100.0;
        }
    }
}

/// Order book snapshot
#[derive(Debug, Clone)]
pub struct OrderBookSnapshot {
    pub symbol: String,
    pub last_update_id: u64,
    pub bids: Vec<(u64, u64)>, // (price, quantity) - sorted DESC
    pub asks: Vec<(u64, u64)>, // (price, quantity) - sorted ASC
}

impl OrderBookSnapshot {
    pub fn new(symbol: &str) -> Self {
        OrderBookSnapshot {
            symbol: symbol.to_string(),
            last_update_id: 0,
            bids: Vec::new(),
            asks: Vec::new(),
        }
    }
    
    pub fn update_bid(&mut self, price: u64, quantity: u64) {
        if let Some(existing) = self.bids.iter_mut().find(|(p, _)| p == price) {
            if quantity == 0 {
                self.bids.retain(|(p, _)| p != price);
            } else {
                existing.1 = quantity;
            }
        } else if quantity > 0 {
            self.bids.push((price, quantity));
            self.bids.sort_by(|a, b| b.0.cmp(&a.0)); // DESC
        }
    }
    
    pub fn update_ask(&mut self, price: u64, quantity: u64) {
        if let Some(existing) = self.asks.iter_mut().find(|(p, _)| p == price) {
            if quantity == 0 {
                self.asks.retain(|(p, _)| p != price);
            } else {
                existing.1 = quantity;
            }
        } else if quantity > 0 {
            self.asks.push((price, quantity));
            self.asks.sort_by(|a, b| a.0.cmp(&b.0)); // ASC
        }
    }
    
    /// Get best bid
    pub fn best_bid(&self) -> Option<(u64, u64)> {
        self.bids.first().cloned()
    }
    
    /// Get best ask
    pub fn best_ask(&self) -> Option<(u64, u64)> {
        self.asks.first().cloned()
    }
    
    /// Get spread
    pub fn spread(&self) -> Option<u64> {
        match (self.best_bid(), self.best_ask()) {
            (Some((bid, _)), Some((ask, _))) => {
                if ask > bid {
                    Some(ask - bid)
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

/// Trade record
#[derive(Debug, Clone)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub price: u64,
    pub quantity: u64,
    pub buyer_order_id: String,
    pub seller_order_id: String,
    pub is_buyer_maker: bool,
    pub timestamp_ms: u64,
}

impl Trade {
    pub fn new(
        id: String,
        symbol: String,
        price: u64,
        quantity: u64,
    ) -> Self {
        Trade {
            id,
            symbol,
            price,
            quantity,
            buyer_order_id: String::new(),
            seller_order_id: String::new(),
            is_buyer_maker: false,
            timestamp_ms: current_timestamp(),
        }
    }
}

/// Candlestick/Kline
#[derive(Debug, Clone)]
pub struct Kline {
    pub symbol: String,
    pub interval: u32, // 1m, 5m, 15m, 1h, 4h, 1d, etc.
    pub open_time: u64,
    pub open: u64,
    pub high: u64,
    pub low: u64,
    pub close: u64,
    pub volume: u64,
    pub closed: bool,
    pub quote_volume: u64,
    pub trades: u64,
}

impl Kline {
    pub fn new(symbol: &str, interval: u32, open_time: u64) -> Self {
        Kline {
            symbol: symbol.to_string(),
            interval,
            open_time,
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            volume: 0,
            closed: false,
            quote_volume: 0,
            trades: 0,
        }
    }
    
    pub fn update(&mut self, price: u64, quantity: u64) {
        if self.open == 0 {
            self.open = price;
        }
        
        self.close = price;
        self.high = if self.high == 0 || price > self.high { price } else { self.high };
        self.low = if self.low == 0 || price < self.low { price } else { self.low };
        self.volume += quantity;
        self.quote_volume += price * quantity;
        self.trades += 1;
    }
    
    pub fn close_kline(&mut self) {
        self.closed = true;
    }
}

/// Market data aggregator
pub struct MarketAggregator {
    // Market statistics
    markets: HashMap<String, MarketStats>,
    
    // Order books
    order_books: HashMap<String, OrderBookSnapshot>,
    
    // Recent trades
    trades: HashMap<String, VecDeque<Trade>>,
    
    // Klines by symbol and interval
    klines: HashMap<String, HashMap<u32, VecDeque<Kline>>>,
    
    // Trade ID counter
    trade_id_counter: u64,
    
    // Configuration
    max_trades_per_symbol: usize,
    max_klines_per_interval: usize,
}

impl Default for MarketAggregator {
    fn default() -> Self {
        Self::new()
    }
}

impl MarketAggregator {
    pub fn new() -> Self {
        MarketAggregator {
            markets: HashMap::new(),
            order_books: HashMap::new(),
            trades: HashMap::new(),
            klines: HashMap::new(),
            trade_id_counter: 0,
            max_trades_per_symbol: 1000,
            max_klines_per_interval: 1000,
        }
    }
    
    /// Register a new market
    pub fn register_market(&mut self, symbol: &str) {
        self.markets.insert(symbol.to_string(), MarketStats::new(symbol));
        self.order_books.insert(symbol.to_string(), OrderBookSnapshot::new(symbol));
    }
    
    /// Process a trade
    pub fn process_trade(&mut self, symbol: &str, price: u64, quantity: u64) -> &Trade {
        self.trade_id_counter += 1;
        let trade_id = format!("t{}", self.trade_id_counter);
        
        let trade = Trade::new(trade_id, symbol.to_string(), price, quantity);
        
        // Update market stats
        if let Some(stats) = self.markets.get_mut(symbol) {
            stats.update(price, quantity);
        }
        
        // Add to trades list
        let trades = self.trades.entry(symbol.to_string())
            .or_insert_with(|| VecDeque::with_capacity(self.max_trades_per_symbol));
        
        if trades.len() >= self.max_trades_per_symbol {
            trades.pop_front();
        }
        trades.push_back(trade.clone());
        
        // Update kline
        self.update_kline(symbol, price, quantity);
        
        trades.back().unwrap()
    }
    
    /// Process order book update
    pub fn process_order_book(&mut self, symbol: &str, update_id: u64, bids: Vec<(u64, u64)>, asks: Vec<(u64, u64)>) {
        let book = self.order_books.entry(symbol.to_string())
            .or_insert_with(|| OrderBookSnapshot::new(symbol));
        
        book.last_update_id = update_id;
        
        for (price, qty) in bids {
            book.update_bid(price, qty);
        }
        
        for (price, qty) in asks {
            book.update_ask(price, qty);
        }
    }
    
    /// Update kline
    fn update_kline(&mut self, symbol: &str, price: u64, quantity: u64) {
        let now = current_timestamp();
        
        // Common intervals in seconds
        let intervals = vec![60, 300, 900, 3600, 14400, 86400];
        
        for interval in intervals {
            let klines = self.klines.entry(symbol.to_string())
                .or_insert_with(|| HashMap::new());
            
            let kline_deque = klines.entry(interval)
                .or_insert_with(|| VecDeque::with_capacity(self.max_klines_per_interval));
            
            // Get or create current kline
            let current_open = (now / interval as u64) * interval as u64;
            
            if let Some(last) = kline_deque.back_mut() {
                if last.open_time == current_open {
                    // Update existing
                    last.update(price, quantity);
                    return;
                }
            }
            
            // Create new kline
            let mut kline = Kline::new(symbol, interval, current_open);
            kline.update(price, quantity);
            kline_deque.push_back(kline);
            
            if kline_deque.len() > self.max_klines_per_interval {
                kline_deque.pop_front();
            }
        }
    }
    
    /// Get market stats
    pub fn get_stats(&self, symbol: &str) -> Option<&MarketStats> {
        self.markets.get(symbol)
    }
    
    /// Get order book
    pub fn get_order_book(&self, symbol: &str) -> Option<&OrderBookSnapshot> {
        self.order_books.get(symbol)
    }
    
    /// Get recent trades
    pub fn get_recent_trades(&self, symbol: &str, limit: usize) -> Vec<&Trade> {
        self.trades
            .get(symbol)
            .map(|trades| trades.iter().rev().take(limit).collect())
            .unwrap_or_default()
    }
    
    /// Get klines
    pub fn get_klines(&self, symbol: &str, interval: u32, limit: usize) -> Vec<&Kline> {
        self.klines
            .get(symbol)
            .and_then(|k| k.get(&interval))
            .map(|klines| klines.iter().rev().take(limit).collect())
            .unwrap_or_default()
    }
    
    /// Get all symbols
    pub fn symbols(&self) -> Vec<&String> {
        self.markets.keys().collect()
    }
}

/// Stream processor for real-time data
pub struct StreamProcessor {
    aggregator: MarketAggregator,
    subscribers: HashMap<String, Vec<Channel>>,
}

impl StreamProcessor {
    pub fn new() -> Self {
        StreamProcessor {
            aggregator: MarketAggregator::new(),
            subscribers: HashMap::new(),
        }
    }
    
    pub fn register_market(&mut self, symbol: &str) {
        self.aggregator.register_market(symbol);
    }
    
    pub fn process_trade(&mut self, symbol: &str, price: u64, quantity: u64) -> &Trade {
        self.aggregator.process_trade(symbol, price, quantity)
    }
    
    pub fn process_order_book(&mut self, symbol: &str, update_id: u64, bids: Vec<(u64, u64)>, asks: Vec<(u64, u64)>) {
        self.aggregator.process_order_book(symbol, update_id, bids, asks);
    }
    
    pub fn get_stats(&self, symbol: &str) -> Option<&MarketStats> {
        self.aggregator.get_stats(symbol)
    }
    
    pub fn get_order_book(&self, symbol: &str) -> Option<&OrderBookSnapshot> {
        self.aggregator.get_order_book(symbol)
    }
}

/// Channel for subscriptions
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Channel {
    Trade(String),
    Ticker(String),
    OrderBook(String),
    Kline(String, u32),
}

impl Channel {
    pub fn name(&self) -> String {
        match self {
            Channel::Trade(s) => format!("{}@trade", s),
            Channel::Ticker(s) => format!("{}@ticker", s),
            Channel::OrderBook(s) => format!("{}@depth", s),
            Channel::Kline(s, i) => format!("{}@kline_{}", s, i),
        }
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_market_registration() {
        let mut agg = MarketAggregator::new();
        
        agg.register_market("BTC/USDT");
        
        assert!(agg.get_stats("BTC/USDT").is_some());
        assert!(agg.get_order_book("BTC/USDT").is_some());
    }
    
    #[test]
    fn test_trade_processing() {
        let mut agg = MarketAggregator::new();
        
        agg.register_market("BTC/USDT");
        agg.process_trade("BTC/USDT", 50000, 100);
        
        let stats = agg.get_stats("BTC/USDT").unwrap();
        assert_eq!(stats.last_price, 50000);
        assert_eq!(stats.trades_24h, 1);
    }
    
    #[test]
    fn test_order_book() {
        let mut agg = MarketAggregator::new();
        
        agg.register_market("BTC/USDT");
        
        let bids = vec![(50000, 100), (49900, 200)];
        let asks = vec![(50100, 150), (50200, 100)];
        
        agg.process_order_book("BTC/USDT", 1, bids, asks);
        
        let book = agg.get_order_book("BTC/USDT").unwrap();
        assert_eq!(book.spread(), Some(100));
    }
    
    #[test]
    fn test_stream_processor() {
        let mut proc = StreamProcessor::new();
        
        proc.register_market("ETH/USDT");
        proc.process_trade("ETH/USDT", 3000, 50);
        
        let stats = proc.get_stats("ETH/USDT").unwrap();
        assert_eq!(stats.last_price, 3000);
    }
}