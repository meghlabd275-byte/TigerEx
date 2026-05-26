//! Treasury Mgmt - 2026
use std::collections::HashMap;
use std::sync::RwLock;
pub struct TreasuryService { balances: RwLock<HashMap<String, f64>> }
impl TreasuryService {
    pub fn new() -> Self { Self { balances: RwLock::new(HashMap::new()) } }
    pub fn receive(&self, asset: &str, amount: f64) { *self.balances.write().unwrap().entry(asset.to_string()).or_insert(0.0) += amount; }
    pub fn disburse(&self, asset: &str, amount: f64) -> bool { let mut b = self.balances.write().unwrap(); if let Some(bal) = b.get_mut(asset) { if *bal >= amount { *bal -= amount; return true; } } false }
    pub fn balance(&self, asset: &str) -> f64 { *self.balances.read().unwrap().get(asset).unwrap_or(&0.0) }
}
impl Default for TreasuryService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = TreasuryService::new(); } }