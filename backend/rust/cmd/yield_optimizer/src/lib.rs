//! Yield Optimizer - 2026 Auto-Yield
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct YieldStrategy { pub protocol: String, pub apy: f64, pub TVL: f64 }
pub struct YieldOptimizerService { strategies: RwLock<HashMap<String, YieldStrategy>> }
impl YieldOptimizerService {
    pub fn new() -> Self { Self { strategies: RwLock::new(HashMap::new()) } }
    pub fn find_best(&self, asset: &str) -> Option<String> { self.strategies.read().unwrap().values().max_by(|a,b| a.apy.partial_cmp(&b.apy).unwrap()).map(|s| s.protocol.clone()) }
    pub fn invest(&self, user_id: &str, strategy: &str, amount: f64) -> String { format!("invested_{}_{}_{}", user_id, strategy, amount) }
}
impl Default for YieldOptimizerService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = YieldOptimizerService::new(); } }