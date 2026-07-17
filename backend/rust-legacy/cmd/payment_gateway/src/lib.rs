//! Payment Gateway - Rust (fiat on/off ramps)
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Payment { pub id: String, pub user_id: String, pub amount: f64, pub method: String, pub status: String }
pub struct PaymentGatewayService { payments: RwLock<HashMap<String, Payment>> }
impl PaymentGatewayService {
    pub fn new() -> Self { Self { payments: RwLock::new(HashMap::new()) } }
    pub fn deposit(&self, user_id: &str, amount: f64, method: &str) -> String { let id = format!("dep_{}", self.payments.read().unwrap().len()); self.payments.write().unwrap().insert(id.clone(), Payment { id: id.clone(), user_id: user_id.to_string(), amount, method: method.to_string(), status: "pending".to_string() }); id }
    pub fn withdraw(&self, user_id: &str, amount: f64, method: &str) -> Result<String, String> { let id = format!("wd_{}", self.payments.read().unwrap().len()); self.payments.write().unwrap().insert(id.clone(), Payment { id: id.clone(), user_id: user_id.to_string(), amount, method: method.to_string(), status: "pending".to_string() }); Ok(id) }
    pub fn confirm(&self, payment_id: &str) -> Result<(), String> { if let Some(p) = self.payments.write().unwrap().get_mut(payment_id) { p.status = "confirmed".to_string(); Ok(()) } else { Err("Not found".to_string()) } }
}
impl Default for PaymentGatewayService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = PaymentGatewayService::new(); } }