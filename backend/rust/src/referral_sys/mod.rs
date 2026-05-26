//! Referral System - Rust Implementation

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Referral {
    pub referrer: String,
    pub referee: String,
    pub reward: f64,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status { Pending, Claimed, Paid }

pub struct ReferralService {
    referrals: HashMap<String, Referral>,
    counts: HashMap<String, u32>,
}

impl ReferralService {
    pub fn new() -> Self { Self { referrals: HashMap::new(), counts: HashMap::new() } }
    pub fn create(&mut self, referrer: &str, referee: &str) -> String {
        let id = format!("REF_{}", self.referrals.len());
        self.referrals.insert(id.clone(), Referral { referrer: referrer.to_string(), referee: referee.to_string(), reward: 25.0, status: Status::Pending });
        *self.counts.entry(referrer.to_string()).or_insert(0) += 1;
        id
    }
    pub fn claim(&mut self, id: &str) -> Result<f64, String> {
        let r = self.referrals.get_mut(id).ok_or("Referral not found")?;
        if r.status != Status::Pending { return Err("Already claimed".into()); }
        r.status = Status::Claimed;
        Ok(r.reward)
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test() { let mut r = ReferralService::new(); let id = r.create("user1", "user2"); assert!(!id.is_empty()); } }
