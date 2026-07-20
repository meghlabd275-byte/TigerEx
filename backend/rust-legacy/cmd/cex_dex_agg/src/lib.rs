//! CEX-DEX Aggregation - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct DEXPool { pub protocol: String, pub tvl: f64, pub apy: f64 }
pub struct CEXDEXAggService { dex_pools: RwLock<HashMap<String, Vec<DEXPool>>>, cex_enabled: RwLock<Vec<String>> }
impl CEXDEXAggService {
    pub fn new() -> Self { Self { dex_pools: RwLock::new(HashMap::new()), cex_enabled: RwLock::new(vec!["binance".to_string()]) } }
    pub fn get_best_route(&self, asset: &str) -> String { "cex".to_string() }
    pub fn aggregate(&self, asset: &str) -> f64 { 50000.0 }
}
impl Default for CEXDEXAggService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = CEXDEXAggService::new(); } }