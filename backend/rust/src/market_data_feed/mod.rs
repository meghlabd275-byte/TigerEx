//! TigerEx Market Data Feed Service
//! 
//! High-performance, low-latency market data streaming service
//! Supports WebSocket, gRPC, and HTTP streaming
//!
//! Features:
//! - Real-time price feeds
//! - Order book snapshots and deltas
//! - Trade history
//! - Kline/candlestick data
//! - Multiple exchange aggregation
//! - Data normalization

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use serde::{Serialize, Deserialize};
use tokio::sync::broadcast;

// ============================================================================
// DATA TYPES
// ============================================================================

/// Price ticker for a symbol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub symbol: String,
    pub price: f64,
    pub price_change: f64,
    pub price_change_percent: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub volume_24h: f64,
    pub quote_volume_24h: f64,
    pub trades_24h: u64,
    pub open_time: i64,
    pub close_time: i64,
    pub bid_price: f64,
    pub ask_price: f64,
    pub bid_quantity: f64,
    pub ask_quantity: f64,
    pub timestamp: i64,
}

/// Order book entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookEntry {
    pub price: f64,
    pub quantity: f64,
    pub orders: u32,
}

/// Order book snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookEntry>,
    pub asks: Vec<OrderBookEntry>,
    pub last_update_id: u64,
    pub timestamp: i64,
}

/// Trade execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub trade_id: String,
    pub symbol: String,
    pub price: f64,
    pub quantity: f64,
    pub quote_quantity: f64,
    pub is_buyer_maker: bool,
    pub time: i64,
}

/// Kline/candlestick
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kline {
    pub symbol: String,
    pub interval: String,
    pub open_time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub close_time: i64,
    pub quote_volume: f64,
    pub trades: u32,
    pub is_closed: bool,
}

/// Market statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketStats {
    pub symbol: String,
    pub total_volume_24h: f64,
    pub total_trades_24h: u64,
    pub average_price_24h: f64,
    pub price_change_24h: f64,
    pub price_change_percent_24h: f64,
    pub market_cap: Option<f64>,
    pub circulating_supply: Option<f64>,
    pub total_supply: Option<f64>,
    pub max_supply: Option<f64>,
    pub rank: Option<u32>,
}

/// Exchange rate
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeRate {
    pub base: String,
    pub quote: String,
    pub rate: f64,
    pub timestamp: i64,
}

// ============================================================================
// MARKET DATA ENGINE
// ============================================================================

/// Market data feed configuration
#[derive(Debug, Clone)]
pub struct MarketDataConfig {
    pub max_order_book_depth: usize,
    pub max_trade_history: usize,
    pub kline_intervals: Vec<String>,
    pub enable_aggregation: bool,
    pub cache_ttl_seconds: u64,
}

impl Default for MarketDataConfig {
    fn default() -> Self {
        Self {
            max_order_book_depth: 100,
            max_trade_history: 10000,
            kline_intervals: vec![
                "1s".to_string(),
                "1m".to_string(),
                "5m".to_string(),
                "15m".to_string(),
                "1h".to_string(),
                "4h".to_string(),
                "1d".to_string(),
                "1w".to_string(),
            ],
            enable_aggregation: true,
            cache_ttl_seconds: 60,
        }
    }
}

/// Main market data engine
pub struct MarketDataEngine {
    // Data storage
    tickers: RwLock<HashMap<String, Ticker>>,
    order_books: RwLock<HashMap<String, OrderBook>>,
    trade_history: RwLock<HashMap<String, VecDeque<Trade>>>,
    klines: RwLock<HashMap<String, HashMap<String, VecDeque<Kline>>>>,
    exchange_rates: RwLock<HashMap<String, ExchangeRate>>,
    
    // Broadcast channels for streaming
    ticker_tx: broadcast::Sender<Ticker>,
    order_book_tx: broadcast::Sender<OrderBook>,
    trade_tx: broadcast::Sender<Trade>,
    kline_tx: broadcast::Sender<Kline>,
    
    // Configuration
    config: MarketDataConfig,
    
    // Statistics
    stats: RwLock<MarketDataStats>,
}

/// Market data engine statistics
#[derive(Debug, Clone, Default)]
pub struct MarketDataStats {
    pub messages_sent: u64,
    pub messages_received: u64,
    pub total_subscribers: u64,
    pub last_update: i64,
}

impl MarketDataEngine {
    /// Create a new market data engine
    pub fn new(config: MarketDataConfig) -> Self {
        let (ticker_tx, _) = broadcast::channel(10000);
        let (order_book_tx, _) = broadcast::channel(10000);
        let (trade_tx, _) = broadcast::channel(10000);
        let (kline_tx, _) = broadcast::channel(10000);
        
        Self {
            tickers: RwLock::new(HashMap::new()),
            order_books: RwLock::new(HashMap::new()),
            trade_history: RwLock::new(HashMap::new()),
            klines: RwLock::new(HashMap::new()),
            exchange_rates: RwLock::new(HashMap::new()),
            ticker_tx,
            order_book_tx,
            trade_tx,
            kline_tx,
            config,
            stats: RwLock::new(MarketDataStats::default()),
        }
    }
    
    /// Initialize default symbols
    pub fn initialize_symbols(&self, symbols: Vec<String>) {
        let mut tickers = self.tickers.write().unwrap();
        let mut order_books = self.order_books.write().unwrap();
        let mut trade_history = self.trade_history.write().unwrap();
        let mut klines = self.klines.write().unwrap();
        
        for symbol in symbols {
            // Initialize ticker with default values
            tickers.insert(symbol.clone(), Ticker {
                symbol: symbol.clone(),
                price: 0.0,
                price_change: 0.0,
                price_change_percent: 0.0,
                high_24h: 0.0,
                low_24h: 0.0,
                volume_24h: 0.0,
                quote_volume_24h: 0.0,
                trades_24h: 0,
                open_time: 0,
                close_time: 0,
                bid_price: 0.0,
                ask_price: 0.0,
                bid_quantity: 0.0,
                ask_quantity: 0.0,
                timestamp: current_timestamp(),
            });
            
            // Initialize order book
            order_books.insert(symbol.clone(), OrderBook {
                symbol: symbol.clone(),
                bids: Vec::new(),
                asks: Vec::new(),
                last_update_id: 0,
                timestamp: current_timestamp(),
            });
            
            // Initialize trade history
            trade_history.insert(symbol.clone(), VecDeque::with_capacity(self.config.max_trade_history));
            
            // Initialize klines for all intervals
            let mut symbol_klines: HashMap<String, VecDeque<Kline>> = HashMap::new();
            for interval in &self.config.kline_intervals {
                symbol_klines.insert(interval.clone(), VecDeque::with_capacity(1000));
            }
            klines.insert(symbol.clone(), symbol_klines);
        }
    }
    
    /// Update ticker data
    pub fn update_ticker(&self, ticker: Ticker) {
        let mut tickers = self.tickers.write().unwrap();
        tickers.insert(ticker.symbol.clone(), ticker.clone());
        
        // Broadcast to subscribers
        let _ = self.ticker_tx.send(ticker);
        
        // Update stats
        let mut stats = self.stats.write().unwrap();
        stats.messages_sent += 1;
        stats.last_update = current_timestamp();
    }
    
    /// Update order book
    pub fn update_order_book(&self, order_book: OrderBook) {
        let mut books = self.order_books.write().unwrap();
        books.insert(order_book.symbol.clone(), order_book.clone());
        
        // Broadcast to subscribers
        let _ = self.order_book_tx.send(order_book);
        
        // Update stats
        let mut stats = self.stats.write().unwrap();
        stats.messages_sent += 1;
    }
    
    /// Add trade to history
    pub fn add_trade(&self, trade: Trade) {
        let mut history = self.trade_history.write().unwrap();
        
        if let Some(trades) = history.get_mut(&trade.symbol) {
            if trades.len() >= self.config.max_trade_history {
                trades.pop_back();
            }
            trades.push_front(trade.clone());
        }
        
        // Broadcast to subscribers
        let _ = self.trade_tx.send(trade);
        
        // Update stats
        let mut stats = self.stats.write().unwrap();
        stats.messages_sent += 1;
    }
    
    /// Update kline/candlestick
    pub fn update_kline(&self, kline: Kline) {
        let mut klines = self.klines.write().unwrap();
        
        if let Some(symbol_klines) = klines.get_mut(&kline.symbol) {
            if let Some(interval_klines) = symbol_klines.get_mut(&kline.interval) {
                // Update or add
                if let Some(last) = interval_klines.back() {
                    if last.open_time == kline.open_time {
                        // Update existing
                        interval_klines.pop_back();
                    }
                }
                
                if interval_klines.len() >= 1000 {
                    interval_klines.pop_back();
                }
                interval_klines.push_back(kline.clone());
            }
        }
        
        // Broadcast to subscribers
        let _ = self.kline_tx.send(kline);
        
        // Update stats
        let mut stats = self.stats.write().unwrap();
        stats.messages_sent += 1;
    }
    
    /// Get ticker for symbol
    pub fn get_ticker(&self, symbol: &str) -> Option<Ticker> {
        let tickers = self.tickers.read().unwrap();
        tickers.get(symbol).cloned()
    }
    
    /// Get all tickers
    pub fn get_all_tickers(&self) -> Vec<Ticker> {
        let tickers = self.tickers.read().unwrap();
        tickers.values().cloned().collect()
    }
    
    /// Get order book for symbol
    pub fn get_order_book(&self, symbol: &str) -> Option<OrderBook> {
        let books = self.order_books.read().unwrap();
        books.get(symbol).cloned()
    }
    
    /// Get trade history for symbol
    pub fn get_trade_history(&self, symbol: &str, limit: usize) -> Vec<Trade> {
        let history = self.trade_history.read().unwrap();
        
        if let Some(trades) = history.get(symbol) {
            trades.iter().take(limit).cloned().collect()
        } else {
            Vec::new()
        }
    }
    
    /// Get klines for symbol and interval
    pub fn get_klines(&self, symbol: &str, interval: &str, limit: usize) -> Vec<Kline> {
        let klines = self.klines.read().unwrap();
        
        if let Some(symbol_klines) = klines.get(symbol) {
            if let Some(interval_klines) = symbol_klines.get(interval) {
                return interval_klines.iter().rev().take(limit).cloned().collect();
            }
        }
        
        Vec::new()
    }
    
    /// Subscribe to ticker updates
    pub fn subscribe_ticker(&self) -> broadcast::Receiver<Ticker> {
        self.ticker_tx.subscribe()
    }
    
    /// Subscribe to order book updates
    pub fn subscribe_order_book(&self) -> broadcast::Receiver<OrderBook> {
        self.order_book_tx.subscribe()
    }
    
    /// Subscribe to trade updates
    pub fn subscribe_trades(&self) -> broadcast::Receiver<Trade> {
        self.trade_tx.subscribe()
    }
    
    /// Subscribe to kline updates
    pub fn subscribe_klines(&self) -> broadcast::Receiver<Kline> {
        self.kline_tx.subscribe()
    }
    
    /// Get statistics
    pub fn get_stats(&self) -> MarketDataStats {
        let stats = self.stats.read().unwrap();
        stats.clone()
    }
    
    /// Update exchange rate
    pub fn update_exchange_rate(&self, rate: ExchangeRate) {
        let mut rates = self.exchange_rates.write().unwrap();
        let key = format!("{}_{}", rate.base, rate.quote);
        rates.insert(key, rate);
    }
    
    /// Get exchange rate
    pub fn get_exchange_rate(&self, base: &str, quote: &str) -> Option<ExchangeRate> {
        let rates = self.exchange_rates.read().unwrap();
        let key = format!("{}_{}", base, quote);
        rates.get(&key).cloned()
    }
}

// ============================================================================
// DATA NORMALIZER
// ============================================================================

/// Normalizes data from different exchange formats
pub struct DataNormalizer;

impl DataNormalizer {
    /// Normalize ticker from generic exchange format
    pub fn normalize_ticker(data: &serde_json::Value) -> Option<Ticker> {
        Some(Ticker {
            symbol: data.get("symbol")?.as_str()?.to_string(),
            price: data.get("price")?.as_f64()?,
            price_change: data.get("priceChange")?.as_f64().unwrap_or(0.0),
            price_change_percent: data.get("priceChangePercent")?.as_f64().unwrap_or(0.0),
            high_24h: data.get("high")?.as_f64().unwrap_or(0.0),
            low_24h: data.get("low")?.as_f64().unwrap_or(0.0),
            volume_24h: data.get("volume")?.as_f64().unwrap_or(0.0),
            quote_volume_24h: data.get("quoteVolume")?.as_f64().unwrap_or(0.0),
            trades_24h: data.get("count")?.as_u64().unwrap_or(0),
            open_time: data.get("openTime")?.as_i64().unwrap_or(0),
            close_time: data.get("closeTime")?.as_i64().unwrap_or(0),
            bid_price: data.get("bidPrice")?.as_f64().unwrap_or(0.0),
            ask_price: data.get("askPrice")?.as_f64().unwrap_or(0.0),
            bid_quantity: data.get("bidQty")?.as_f64().unwrap_or(0.0),
            ask_quantity: data.get("askQty")?.as_f64().unwrap_or(0.0),
            timestamp: current_timestamp(),
        })
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Get current timestamp in milliseconds
fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
