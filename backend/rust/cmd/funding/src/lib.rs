//! Funding Service - Rust (funding rates, interest)
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct FundingRate { pub symbol: String, pub rate: f64, pub next_update: u64 }
pub struct FundingService { rates: RwLock<HashMap<String, FundingRate>>, funding_pools: RwLock<HashMap<String, f64>> }
impl FundingService {
    pub fn new() -> Self { Self { rates: RwLock::new(HashMap::new()), funding_pools: RwLock::new(HashMap::new()) } }
    pub fn update_rate(&self, symbol: &str, rate: f64) { self.rates.write().unwrap().insert(symbol.to_string(), FundingRate { symbol: symbol.to_string(), rate, next_update: 0 }); }
    pub fn get_rate(&self, symbol: &str) -> f64 { self.rates.read().unwrap().get(symbol).map(|r| r.rate).unwrap_or(0.0001) }
    pub fn apply_funding(&self, user_id: &str, symbol: &str, position: f64) -> f64 { position * self.get_rate(symbol) }
}
impl Default for FundingService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = FundingService::new(); } }