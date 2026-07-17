//! Trading Pairs - Rust
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)]
pub struct Pair { pub symbol: String, pub base: String, pub quote: String, pub min_qty: f64, pub min_notional: f64, pub maker_fee: f64, pub taker_fee: f64 }
pub struct PairService { pairs: RwLock<HashMap<String, Pair>> }
impl PairService {
    pub fn new() -> Self {
        let svc = Self { pairs: RwLock::new(HashMap::new()) };
        svc.pairs.write().unwrap().insert("BTC/USDT".to_string(), Pair { symbol: "BTC/USDT".to_string(), base: "BTC".to_string(), quote: "USDT".to_string(), min_qty: 0.0001, min_notional: 5.0, maker_fee: 0.001, taker_fee: 0.001 });
        svc
    }
    pub fn get_pair(&self, symbol: &str) -> Option<Pair> { self.pairs.read().unwrap().get(symbol).cloned() }
    pub fn list_pairs(&self) -> Vec<String> { self.pairs.read().unwrap().keys().cloned().collect() }
}
impl Default for PairService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test_pairs() { let s = PairService::new(); assert!(s.get_pair("BTC/USDT").is_some()); } }