//! Oracle Service - Rust Implementation
//! 
//! Price oracles: Chainlink, Band, internal

use serde::{Serialize, Deserialize>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceFeed {
    pub symbol: String,
    pub price: f64,
    pub timestamp: i64,
    pub source: String,
}

pub struct Oracle {
    feeds: std::collections::HashMap<String, PriceFeed>,
}

impl Oracle {
    pub fn new() -> Self { Self { feeds: std::collections::HashMap::new() }
    
    pub fn update(&mut self, sym: &str, price: f64, source: &str) {
        self.feeds.insert(sym.to_string(), PriceFeed {
            symbol: sym.to_string(),
            price,
            timestamp: current_ts(),
            source: source.to_string(),
        });
    }
    
    pub fn get_price(&self, sym: &str) -> Option<f64> {
        self.feeds.get(sym).map(|f| f.price)
    }
}

fn current_ts() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

#[cfg(test)] mod tests { use super::*; #[test] fn test_oracle() { let mut o = Oracle::new(); o.update("BTC", 50000.0, "chainlink"); assert!(o.get_price("BTC").is_some()); } }