//! Gasless Transactions - 2026
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct GaslessTx { pub tx_hash: String, pub user_id: String, pub fee_payer: String, pub gas_sponsored: bool }
pub struct GaslessTxService { transactions: RwLock<HashMap<String, GaslessTx>> }
impl GaslessTxService {
    pub fn new() -> Self { Self { transactions: RwLock::new(HashMap::new()) } }
    pub fn sponsor(&self, user_id: &str, tx_data: &str) -> Result<String, String> {
        let id = format!("gl_{}", tx_data.len());
        self.transactions.write().unwrap().insert(id.clone(), GaslessTx { tx_hash: id.clone(), user_id: user_id.to_string(), fee_payer: "platform".to_string(), gas_sponsored: true });
        Ok(id)
    }
    pub fn is_sponsored(&self, tx_hash: &str) -> bool { self.transactions.read().unwrap().get(tx_hash).map(|t| t.gas_sponsored).unwrap_or(false) }
}
impl Default for GaslessTxService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = GaslessTxService::new(); } }