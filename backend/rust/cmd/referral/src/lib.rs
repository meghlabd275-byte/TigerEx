//! Referral Service - Rust
use std::collections::HashMap;
use std::sync::RwLock;
pub struct ReferralService {
    referrers: RwLock<HashMap<String, String>>,
    referrals: RwLock<HashMap<String, Vec<String>>>,
    rewards: RwLock<HashMap<String, f64>>,
}
impl ReferralService {
    pub fn new() -> Self { Self { referrers: RwLock::new(HashMap::new()), referrals: RwLock::new(HashMap::new()), rewards: RwLock::new(HashMap::new()) } }
    pub fn create_link(&self, user_id: &str) -> String { format!("ref_{}", user_id) }
    pub fn add_referral(&self, referrer: &str, referee: &str) {
        self.referrers.write().unwrap().insert(referee.to_string(), referrer.to_string());
        self.referrals.write().unwrap().entry(referrer.to_string()).or_insert_with(Vec::new).push(referee.to_string());
    }
    pub fn get_reward(&self, user_id: &str) -> f64 { *self.rewards.read().unwrap().get(user_id).unwrap_or(&0.0) }
    pub fn claim_reward(&self, user_id: &str) -> f64 { self.rewards.write().unwrap().remove(user_id).unwrap_or(0.0) }
}
impl Default for ReferralService { fn default() -> Self { Self::new() } }
#[cfg(test)] mod tests { use super::*; #[test] fn test_ref() { let s = ReferralService::new(); assert!(s.create_link("u1").starts_with("ref_")); } }