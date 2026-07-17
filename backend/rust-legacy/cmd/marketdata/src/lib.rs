//! TigerEx Market Data Service - Rust
//! High-throughput market data aggregation

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Ticker data
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Ticker {
    pub symbol: String,
    pub price: f64,
    pub change_24h: f64,
    pub change_percent_24h: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub volume_24h: f64,
    pub quote_volume_24h: f64,
    pub timestamp: u64,
}

impl Ticker {
    pub fn new(symbol: &str, price: f64) -> Self {
        Self {
            symbol: symbol.to_string(),
            price,
            change_24h: 0.0,
            change_percent_24h: 0.0,
            high_24h: price,
            low_24h: price,
            volume_24h: 0.0,
            quote_volume_24h: 0.0,
            timestamp: current_timestamp(),
        }
    }

    pub fn update(&mut self, price: f64, volume: f64) {
        self.price = price;
        self.volume_24h += volume;
        self.quote_volume_24h += price * volume;
        
        if price > self.high_24h {
            self.high_24h = price;
        }
        if price < self.low_24h {
            self.low_24h = price;
        }
        
        self.timestamp = current_timestamp();
    }
}

/// Trade
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub price: f64,
    pub quantity: f64,
    pub side: String,
    pub timestamp: u64,
}

/// Order book level
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrderBookLevel {
    pub price: f64,
    pub quantity: f64,
}

/// Order book
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookLevel>,
    pub asks: Vec<OrderBookLevel>,
    pub timestamp: u64,
}

impl OrderBook {
    pub fn new(symbol: &str) -> Self {
        Self {
            symbol: symbol.to_string(),
            bids: Vec::new(),
            asks: Vec::new(),
            timestamp: current_timestamp(),
        }
    }
}

/// Market data service
pub struct MarketDataService {
    tickers: RwLock<HashMap<String, Ticker>>,
    trades: RwLock<HashMap<String, Vec<Trade>>>,
    order_books: RwLock<HashMap<String, OrderBook>>,
    subscriptions: RwLock<HashMap<String, Vec<String>>>,
}

impl MarketDataService {
    pub fn new() -> Self {
        Self {
            tickers: RwLock::new(HashMap::new()),
            trades: RwLock::new(HashMap::new()),
            order_books: RwLock::new(HashMap::new()),
            subscriptions: RwLock::new(HashMap::new()),
        }
    }

    /// Get ticker
    pub fn get_ticker(&self, symbol: &str) -> Option<Ticker> {
        let tickers = self.tickers.read().unwrap();
        tickers.get(symbol).cloned()
    }

    /// Update ticker
    pub fn update_ticker(&self, symbol: &str, price: f64, volume: f64) {
        let mut tickers = self.tickers.write().unwrap();
        
        if let Some(ticker) = tickers.get_mut(symbol) {
            ticker.update(price, volume);
        } else {
            let mut ticker = Ticker::new(symbol, price);
            ticker.update(price, volume);
            tickers.insert(symbol.to_string(), ticker);
        }
    }

    /// Get recent trades
    pub fn get_trades(&self, symbol: &str, limit: usize) -> Vec<Trade> {
        let trades = self.trades.read().unwrap();
        trades
            .get(symbol)
            .map(|t| t.iter().rev().take(limit).cloned().collect())
            .unwrap_or_default()
    }

    /// Add trade
    pub fn add_trade(&self, trade: Trade) {
        let mut trades = self.trades.write().unwrap();
        
        let entry = trades.entry(trade.symbol.clone()).or_insert_with(Vec::new);
        entry.push(trade);
        
        // Keep last 1000 trades
        if entry.len() > 1000 {
            entry.remove(0);
        }
    }

    /// Get order book
    pub fn get_orderbook(&self, symbol: &str) -> Option<OrderBook> {
        let books = self.order_books.read().unwrap();
        books.get(symbol).cloned()
    }

    /// Update order book
    pub fn update_orderbook(&self, symbol: &str, book: OrderBook) {
        let mut books = self.order_books.write().unwrap();
        books.insert(symbol.to_string(), book);
    }

    /// Subscribe to symbol updates
    pub fn subscribe(&self, user_id: &str, symbol: &str) {
        let mut subs = self.subscriptions.write().unwrap();
        subs.entry(symbol.to_string())
            .or_insert_with(Vec::new)
            .push(user_id.to_string());
    }

    /// Unsubscribe
    pub fn unsubscribe(&self, user_id: &str, symbol: &str) {
        let mut subs = self.subscriptions.write().unwrap();
        
        if let Some(users) = subs.get_mut(symbol) {
            users.retain(|u| u != user_id);
        }
    }

    /// Get 24h stats for symbol
    pub fn get_stats(&self, symbol: &str) -> Option<MarketStats> {
        let tickers = self.tickers.read().unwrap();
        
        tickers.get(symbol).map(|t| MarketStats {
            symbol: t.symbol.clone(),
            open: t.price - t.change_24h,
            high: t.high_24h,
            low: t.low_24h,
            close: t.price,
            volume: t.volume_24h,
            quote_volume: t.quote_volume_24h,
        })
    }
}

impl Default for MarketDataService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MarketStats {
    pub symbol: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub quote_volume: f64,
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
    fn test_ticker() {
        let service = MarketDataService::new();
        
        service.update_ticker("BTC/USDT", 50000.0, 1.5);
        let ticker = service.get_ticker("BTC/USDT").unwrap();
        
        assert_eq!(ticker.price, 50000.0);
    }
}