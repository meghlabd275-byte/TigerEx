//! Margin Service - Rust
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct MarginAccount { pub user_id: String, pub collateral: f64, pub debt: f64, pub margin_ratio: f64 }
pub struct MarginService { accounts: RwLock<HashMap<String, MarginAccount>> }
impl MarginService {
    pub fn new() -> Self { Self { accounts: RwLock::new(HashMap::new()) } }
    pub fn open_account(&self, user_id: &str, collateral: f64) { self.accounts.write().unwrap().insert(user_id.to_string(), MarginAccount { user_id: user_id.to_string(), collateral, debt: 0.0, margin_ratio: 0.0 }); }
    pub fn add_collateral(&self, user_id: &str, amount: f64) -> Result<(), String> { if let Some(a) = self.accounts.write().unwrap().get_mut(user_id) { a.collateral += amount; Ok(()) } else { Err("Account not found".to_string()) } }
    pub fn borrow(&self, user_id: &str, amount: f64) -> Result<(), String> { if let Some(a) = self.accounts.write().unwrap().get_mut(user_id) { let ratio = a.debt / (a.collateral + amount); if ratio > 0.8 { return Err("Margin too low".to_string()); } a.debt += amount; Ok(()) } else { Err("Account not found".to_string()) } }
}
impl Default for MarginService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = MarginService::new(); } }