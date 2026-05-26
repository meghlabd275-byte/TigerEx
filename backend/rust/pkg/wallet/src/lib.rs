//! Wallet Utility - Rust
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Wallet { pub user_id: String, pub balances: HashMap<String, f64> }
pub struct WalletUtil { wallets: RwLock<HashMap<String, Wallet>> }
impl WalletUtil {
    pub fn new() -> Self { Self { wallets: RwLock::new(HashMap::new()) } }
    pub fn create(&self, user_id: &str) { self.wallets.write().unwrap().insert(user_id.to_string(), Wallet { user_id: user_id.to_string(), balances: HashMap::new() }); }
    pub fn balance(&self, user_id: &str, asset: &str) -> f64 { self.wallets.read().unwrap().get(user_id).and_then(|w| w.balances.get(asset)).copied().unwrap_or(0.0) }
}
impl Default for WalletUtil { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let w = WalletUtil::new(); } }