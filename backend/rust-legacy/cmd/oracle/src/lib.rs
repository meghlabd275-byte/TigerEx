//! Oracle Price Feed - Rust
use std::collections::HashMap;
use std::sync::{RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct Price { pub symbol: String, pub price: f64, pub timestamp: u64 }
pub struct OracleService { prices: RwLock<HashMap<String, Price>> }
impl OracleService {
    pub fn new() -> Self { Self { prices: RwLock::new(HashMap::new()) } }
    pub fn set_price(&self, symbol: &str, price: f64) { self.prices.write().unwrap().insert(symbol.to_string(), Price { symbol: symbol.to_string(), price, timestamp: current_timestamp() }); }
    pub fn get_price(&self, symbol: &str) -> Option<f64> { self.prices.read().unwrap().get(symbol).map(|p| p.price) }
}
impl Default for OracleService { fn default() -> Self { Self::new() } }
fn current_timestamp() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }
#[cfg(test)] mod tests { use super::*; #[test] fn test_oracle() { let o = OracleService::new(); o.set_price("BTC", 50000.0); assert_eq!(o.get_price("BTC"), Some(50000.0)); } }