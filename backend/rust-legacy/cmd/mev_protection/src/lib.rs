//! MEV Protection - 2026 Front-Running Prevention
use std::collections::HashSet;
use std::sync::RwLock;
#[derive(Debug, Clone)] pub struct ProtectedTx { pub tx_hash: String, pub user_id: String, pub bundle_id: Option<String>, pub protected_at: u64 }
pub struct MEVProtectionService { protected: RwLock<HashSet<String>>, bundles: RwLock<HashSet<String>>> }
impl MEVProtectionService {
    pub fn new() -> Self { Self { protected: RwLock::new(HashSet::new()), bundles: RwLock::new(HashSet::new()) } }
    pub fn protect(&self, tx_hash: &str, user_id: &str) -> String { self.protected.write().unwrap().insert(tx_hash.to_string()); format!("protected_{}", tx_hash) }
    pub fn bundle(&self, tx_hashes: Vec<String>) -> String { let id = format!("bundle_{}", self.bundles.read().unwrap().len()); self.bundles.write().unwrap().insert(id.clone()); id }
    pub fn is_protected(&self, tx_hash: &str) -> bool { self.protected.read().unwrap().contains(tx_hash) }
}
impl Default for MEVProtectionService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = MEVProtectionService::new(); } }