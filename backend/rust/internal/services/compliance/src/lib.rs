//! Compliance Service - Rust (AML/KYC)
use std::collections::HashSet;
use std::sync::RwLock;

pub struct ComplianceService {
    blacklisted: RwLock<HashSet<String>>,
    suspicions: RwLock<HashSet<String>>,
}
impl ComplianceService {
    pub fn new() -> Self { Self { blacklisted: RwLock::new(HashSet::new()), suspicions: RwLock::new(HashSet::new()) } }
    pub fn check_user(&self, user_id: &str) -> CheckResult {
        if self.blacklisted.read().unwrap().contains(user_id) { return CheckResult::Blocked("Blacklisted".to_string()); }
        if self.suspicions.read().unwrap().contains(user_id) { return CheckResult::Review; }
        CheckResult::Allowed
    }
    pub fn flag_suspicious(&self, user_id: &str) { self.suspicions.write().unwrap().insert(user_id.to_string()); }
    pub fn blacklist(&self, user_id: &str) { self.blacklisted.write().unwrap().insert(user_id.to_string()); }
}
impl Default for ComplianceService { fn default() -> Self { Self::new() } }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckResult { Allowed, Review, Blocked(String) }
#[cfg(test)] mod tests { use super::*; #[test] fn test_compliance() { let s = ComplianceService::new(); assert_eq!(s.check_user("unknown"), CheckResult::Allowed); } }