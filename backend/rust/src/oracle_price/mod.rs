//! Price Oracle - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PricePoint { pub symbol: String, pub price: f64, pub timestamp: i64, pub source: String }

pub struct PriceOracle { prices: HashMap<String, PricePoint> }

impl PriceOracle { pub fn new() -> Self { Self { prices: HashMap::new() } }
    pub fn update(&mut self, sym: &str, px: f64, src: &str) {
        self.prices.insert(sym.to_string(), PricePoint { symbol: sym.to_string(), price: px, timestamp: now_ms(), source: src.to_string() });
    }
    pub fn get(&self, sym: &str) -> Option<f64> { self.prices.get(sym).map(|p| p.price) }
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut o = PriceOracle::new(); o.update("BTC/USD", 50000.0, "binance"); assert!(o.get("BTC/USD").unwrap() == 50000.0); } }
