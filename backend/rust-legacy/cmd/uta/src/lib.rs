//! Unified Trading Account (UTA 2.0) - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct UTAPosition { pub id: String, pub product: String, pub asset: String, pub size: f64, pub notional: f64 }
#[derive(Debug, Clone)] pub struct UTAAccount { pub user_id: String, pub portfolio_value: f64, pub cross_margin_used: f64, pub positions: Vec<UTAPosition> }
pub struct UTAService { accounts: RwLock<HashMap<String, UTAAccount>>, max_leverage: u32 }
impl UTAService {
    pub fn new() -> Self { Self { accounts: RwLock::new(HashMap::new()), max_leverage: 10 } }
    pub fn open_position(&self, user_id: &str, product: &str, asset: &str, size: f64, notional: f64) -> Result<String, String> {
        let account = self.accounts.write().unwrap();
        let acc = account.entry(user_id.to_string()).or_insert(UTAAccount { user_id: user_id.to_string(), portfolio_value: 0.0, cross_margin_used: 0.0, positions: Vec::new() });
        acc.positions.push(UTAPosition { id: format!("pos_{}", acc.positions.len()), product: product.to_string(), asset: asset.to_string(), size, notional });
        Ok("position_opened".to_string())
    }
    pub fn get_portfolio_value(&self, user_id: &str) -> f64 { self.accounts.read().unwrap().get(user_id).map(|a| a.portfolio_value).unwrap_or(0.0) }
}
impl Default for UTAService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test_uta() { let s = UTAService::new(); } }