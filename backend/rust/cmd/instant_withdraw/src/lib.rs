//! Instant Withdrawal - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Withdrawal { pub id: String, pub user_id: String, pub asset: String, pub amount: f64, pub method: String, pub status: String }
pub struct InstantWithdrawService { queue: RwLock<Vec<Withdrawal>>, limits: RwLock<HashMap<String, f64>> }
impl InstantWithdrawService {
    pub fn new() -> Self { Self { queue: RwLock::new(Vec::new()), limits: RwLock::new(HashMap::new()) } }
    pub fn request(&self, user_id: &str, asset: &str, amount: f64, method: &str) -> Result<String, String> { 
        let daily_limit = *self.limits.read().unwrap().get(user_id).unwrap_or(&10000.0);
        if amount > daily_limit { return Err("Exceeds daily limit".to_string()); }
        let id = format!("wd_{}", self.queue.read().unwrap().len());
        self.queue.write().unwrap().push(Withdrawal { id: id.clone(), user_id: user_id.to_string(), asset: asset.to_string(), amount, method: method.to_string(), status: "instant".to_string() });
        Ok(id)
    }
}
impl Default for InstantWithdrawService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = InstantWithdrawService::new(); } }