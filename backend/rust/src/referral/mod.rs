//! Referral System - Rust Implementation
//! 
//! Referral program - rewards, commissions, leaderboard

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Referral
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Referral {
    pub referrer_id: String,
    pub referee_id: String,
    pub commission_rate: f64,
    pub total_commission: f64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferralStats {
    pub user_id: String,
    pub total_referees: u32,
    pub total_commission: f64,
    pub rank: u32,
}

/// Referral service
pub struct ReferralService {
    referrals: HashMap<String, Referral>,
    user_referrals: HashMap<String, Vec<String>>,
    referral_codes: HashMap<String, String>,
    counter: u64,
    default_commission: f64,
}

impl ReferralService {
    pub fn new() -> Self {
        Self {
            referrals: HashMap::new(),
            user_referrals: HashMap::new(),
            referral_codes: HashMap::new(),
            counter: 10000,
            default_commission: 0.2, // 20% of fees
        }
    }

    /// Generate referral code
    pub fn generate_code(&mut self, user_id: &str) -> String {
        self.counter += 1;
        let code = format!("REF{:05}", self.counter);
        self.referral_codes.insert(code.clone(), user_id.to_string());
        code
    }

    /// Get referrer by code
    pub fn get_referrer(&self, code: &str) -> Option<&String> {
        self.referral_codes.get(code)
    }

    /// Add referral
    pub fn add_referral(&mut self, referrer_id: &str, referee_id: &str) -> Result<Referral, String> {
        // Check already referred
        if self.referrals.contains_key(referee_id) {
            return Err("Already referred".to_string());
        }

        let referral = Referral {
            referrer_id: referrer_id.to_string(),
            referee_id: referee_id.to_string(),
            commission_rate: self.default_commission,
            total_commission: 0.0,
            created_at: current_timestamp_ms(),
        };

        self.referrals.insert(referee_id.to_string(), referral.clone());
        
        self.user_referrals.entry(referrer_id.to_string())
            .or_insert_with(Vec::new)
            .push(referee_id.to_string());

        Ok(referral)
    }

    /// Record commission
    pub fn record_commission(&mut self, referee_id: &str, amount: f64) -> Result<f64, String> {
        let referral = self.referrals.get_mut(referee_id)
            .ok_or("Referral not found")?;

        let commission = amount * referral.commission_rate;
        referral.total_commission += commission;
        
        Ok(commission)
    }

    /// Get referrer stats
    pub fn get_stats(&self, user_id: &str) -> ReferralStats {
        let referees = self.user_referrals.get(user_id);
        let count = referees.map(|v| v.len() as u32).unwrap_or(0);
        
        let total: f64 = self.referrals.values()
            .filter(|r| r.referrer_id == user_id)
            .map(|r| r.total_commission)
            .sum();

        ReferralStats {
            user_id: user_id.to_string(),
            total_referees: count,
            total_commission: total,
            rank: 0,
        }
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_code() {
        let mut service = ReferralService::new();
        let code = service.generate_code("user1");
        assert!(code.starts_with("REF"));
    }
}