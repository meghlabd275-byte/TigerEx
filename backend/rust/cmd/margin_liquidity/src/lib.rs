//! Margin Liquidity - Rust
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct LiquidityPool { pub asset: String, pub supplied: f64, pub borrowed: f64, pub rate: f64 }
pub struct MarginLiquidityService { pools: RwLock<HashMap<String, LiquidityPool>> }
impl MarginLiquidityService {
    pub fn new() -> Self { Self { pools: RwLock::new(HashMap::new()) } }
    pub fn supply(&self, asset: &str, amount: f64) { self.pools.write().unwrap().entry(asset.to_string()).or_insert_with(|| LiquidityPool { asset: asset.to_string(), supplied: 0.0, borrowed: 0.0, rate: 0.05 }).supplied += amount; }
    pub fn borrow(&self, asset: &str, amount: f64) -> Result<(), String> { if let Some(p) = self.pools.write().unwrap().get_mut(asset) { if p.supplied - p.borrowed >= amount { p.borrowed += amount; Ok(()) } else { Err("Insufficient liquidity".to_string()) } } else { Err("Pool not found".to_string()) } }
}
impl Default for MarginLiquidityService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = MarginLiquidityService::new(); } }