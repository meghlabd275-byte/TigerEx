//! Liquidity Mining - Rust
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Pool { pub token: String, pub tvl: f64, pub apy: f64 }
pub struct LiquidityMiningService { pools: RwLock<HashMap<String, Pool>>> }
impl LiquidityMiningService { pub fn new() -> Self { Self { pools: RwLock::new(HashMap::new()) } }
pub fn add_pool(&self, token: &str, apy: f64) { self.pools.write().unwrap().insert(token.to_string(), Pool { token: token.to_string(), tvl: 0.0, apy }); }}
impl Default for LiquidityMiningService { fn default() -> Self { Self::new() } }