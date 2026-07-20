//! Travel Rule 3.0 - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct TravelRuleData { pub tx_id: String, pub sender: String, pub recipient: String, pub amount: f64, pub verified: bool }
pub struct TravelRuleService { pending: RwLock<Vec<TravelRuleData>>, verified: RwLock<Vec<TravelRuleData>>> }
impl TravelRuleService {
    pub fn new() -> Self { Self { pending: RwLock::new(Vec::new()), verified: RwLock::new(Vec::new()) } }
    pub fn submit(&self, tx_id: &str, sender: &str, recipient: &str, amount: f64) -> String { let t = TravelRuleData { tx_id: tx_id.to_string(), sender: sender.to_string(), recipient: recipient.to_string(), amount, verified: false }; self.pending.write().unwrap().push(t.clone()); t.tx_id }
    pub fn verify(&self, tx_id: &str) -> Result<String, String> { let pending = self.pending.write().unwrap(); if let Some(idx) = pending.iter().position(|t| t.tx_id == tx_id) { let t = pending.remove(idx); self.verified.write().unwrap().push(t.clone()); Ok("verified".to_string()) } else { Err("Not found".to_string()) } }
}
impl Default for TravelRuleService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = TravelRuleService::new(); } }