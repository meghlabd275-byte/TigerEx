//! Rewards - Rust Implementation
//! Referral rewards, loyalty points

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardPoints {
    pub user_id: String,
    pub points: i64,
    pub tier: Tier,
    pub lifetime_points: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Tier { Bronze, Silver, Gold, Diamond, VIP }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardConfig {
    pub trade_reward_rate: f64,
    pub deposit_bonus: f64,
    pub referral_bonus: f64,
}

pub struct RewardsService {
    balances: HashMap<String, RewardPoints>,
    config: RewardConfig,
}

impl RewardsService {
    pub fn new() -> Self {
        Self { balances: HashMap::new(), config: RewardConfig { trade_reward_rate: 0.001, deposit_bonus: 0.01, referral_bonus: 50.0 } }
    }
    
    pub fn award_trades(&mut self, uid: &str, vol: f64) -> i64 {
        let pts = (vol * self.config.trade_reward_rate) as i64;
        let bal = self.balances.entry(uid.to_string()).or_insert_with(|| RewardPoints { user_id: uid.to_string(), points: 0, tier: Tier::Bronze, lifetime_points: 0 });
        bal.points += pts;
        bal.lifetime_points += pts;
        bal.tier = Self::calc_tier(bal.lifetime_points);
        pts
    }
    
    pub fn award_referral(&mut self, uid: &str) -> i64 {
        let pts = self.config.referral_bonus as i64;
        let bal = self.balances.entry(uid.to_string()).or_insert_with(|| RewardPoints { user_id: uid.to_string(), points: 0, tier: Tier::Bronze, lifetime_points: 0 });
        bal.points += pts;
        bal.lifetime_points += pts;
        pts
    }
    
    fn calc_tier(lifetime: i64) -> Tier {
        if lifetime >= 100000 { Tier::VIP } else if lifetime >= 50000 { Tier::Diamond } else if lifetime >= 10000 { Tier::Gold } else if lifetime >= 1000 { Tier::Silver } else { Tier::Bronze }
    }
}

#[cfg(test)] mod tests { use super::*; #[test] fn test_rewards() { let mut s = RewardsService::new(); let pts = s.award_trades("user1", 10000.0); assert!(pts > 0); } }