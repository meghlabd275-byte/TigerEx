//! Subaccount - Rust (multi-subaccounts)
use std::collections::HashMap;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct Subaccount { pub id: String, pub parent_id: String, pub name: String, pub enabled: bool }
pub struct SubaccountService { subaccounts: RwLock<HashMap<String, Subaccount>> }
impl SubaccountService {
    pub fn new() -> Self { Self { subaccounts: RwLock::new(HashMap::new()) } }
    pub fn create(&self, parent_id: &str, name: &str) -> String { let id = format!("sub_{}", self.subaccounts.read().unwrap().len()); self.subaccounts.write().unwrap().insert(id.clone(), Subaccount { id: id.clone(), parent_id: parent_id.to_string(), name: name.to_string(), enabled: true }); id }
    pub fn disable(&self, subaccount_id: &str) -> Result<(), String> { if let Some(s) = self.subaccounts.write().unwrap().get_mut(subaccount_id) { s.enabled = false; Ok(()) } else { Err("Not found".to_string()) } }
    pub fn enable(&self, subaccount_id: &str) -> Result<(), String> { if let Some(s) = self.subaccounts.write().unwrap().get_mut(subaccount_id) { s.enabled = true; Ok(()) } else { Err("Not found".to_string()) } }
}
impl Default for SubaccountService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = SubaccountService::new(); } }