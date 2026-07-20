//! Collateral Mgmt - 2026
use std::collections::HashMap;
use std::sync::RwLock;
pub struct CollateralService { positions: RwLock<HashMap<String, f64>> }
impl CollateralService {
    pub fn new() -> Self { Self { positions: RwLock::new(HashMap::new()) } }
    pub fn post(&self, user_id: &str, asset: &str, amount: f64) { *self.positions.write().unwrap().entry(format!("{}_{}", user_id, asset)).or_insert(0.0) += amount; }
    pub fn available(&self, user_id: &str) -> f64 { self.positions.read().unwrap().iter().filter(|(k,_)| k.starts_with(user_id)).map(|(_,v)| v).sum() }
}
impl Default for CollateralService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = CollateralService::new(); } }