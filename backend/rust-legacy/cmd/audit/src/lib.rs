//! Audit Trail - 2026 Compliance
use std::collections::VecDeque;
use std::sync::RwLock;
pub struct AuditService { entries: RwLock<VecDeque<(String, String)>> }
impl AuditService {
    pub fn new() -> Self { Self { entries: RwLock::new(VecDeque::new()) } }
    pub fn log(&self, user_id: &str, action: &str) { self.entries.write().unwrap().push_back((user_id.to_string(), action.to_string())); }
    pub fn query(&self, user_id: &str) -> Vec<String> { self.entries.read().unwrap().iter().filter(|(u,_)| u==user_id).map(|(_,a)| a.clone()).collect() }
}
impl Default for AuditService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test() { let s = AuditService::new(); } }