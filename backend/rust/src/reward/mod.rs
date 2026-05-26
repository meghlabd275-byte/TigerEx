// Reward - Points and Rebate System
// Rust for loyalty rewards and rebates

use std::collections::HashMap;

// Reward tier
#[derive(Debug, Clone)]
pub struct RewardTier {
    pub tier_id: i32,
    pub name: String,
    pub points_required: i64,
    pub rebate_percent: f64,
    pub fee_discount: f64,
}

// User points
#[derive(Debug, Clone)]
pub struct UserPoints {
    pub user_id: String,
    pub points: i64,
    pub lifetime_points: i64,
    pub tier_id: i32,
}

// Reward redemption
#[derive(Debug, Clone)]
pub struct Redemption {
    pub id: String,
    pub user_id: String,
    pub reward_type: String, // fee_discount, rebate, nft, merchandise
    pub cost_points: i64,
    pub amount: f64,
    pub status: String, // pending, fulfilled, expired
}

// Store
pub struct RewardStore {
    tiers: HashMap<i32, RewardTier>,
    user_points: HashMap<String, UserPoints>,
    redemptions: HashMap<String, Redemption>,
}

impl RewardStore {
    pub fn new() -> Self {
        let tiers = vec![
            RewardTier { tier_id: 1, name: "Bronze".to_string(), points_required: 0, rebate_percent: 5.0, fee_discount: 0.0 },
            RewardTier { tier_id: 2, name: "Silver".to_string(), points_required: 10000, rebate_percent: 10.0, fee_discount: 0.02 },
            RewardTier { tier_id: 3, name: "Gold".to_string(), points_required: 100000, rebate_percent: 20.0, fee_discount: 0.05 },
            RewardTier { tier_id: 4, name: "Platinum".to_string(), points_required: 1000000, rebate_percent: 30.0, fee_discount: 0.10 },
        ];

        let mut store = RewardStore {
            tiers: HashMap::new(),
            user_points: HashMap::new(),
            redemptions: HashMap::new(),
        };

        for t in tiers {
            store.tiers.insert(t.tier_id, t);
        }

        store
    }

    // Add points
    pub fn add_points(&mut self, user_id: &str, points: i64) {
        if let Some(up) = self.user_points.get_mut(user_id) {
            up.points += points;
            up.lifetime_points += points;
            up.tier_id = self.calculate_tier(up.lifetime_points);
        } else {
            self.user_points.insert(user_id.to_string(), UserPoints {
                user_id: user_id.to_string(),
                points,
                lifetime_points: points,
                tier_id: 1,
            });
        }
    }

    // Calculate tier
    fn calculate_tier(&self, lifetime_points: i64) -> i32 {
        for (_, tier) in &self.tiers {
            if lifetime_points >= tier.points_required {
                return tier.tier_id;
            }
        }
        1
    }

    // Get tier
    pub fn get_tier(&self, tier_id: i32) -> Option<&RewardTier> {
        self.tiers.get(&tier_id)
    }

    // Get user tier
    pub fn get_user_tier(&self, user_id: &str) -> Option<&RewardTier> {
        if let Some(up) = self.user_points.get(user_id) {
            self.tiers.get(&up.tier_id)
        } else {
            self.tiers.get(&1)
        }
    }

    // Redeem rewards
    pub fn redeem(&mut self, user_id: &str, reward_type: &str, cost_points: i64, amount: f64) -> Result<String, String> {
        let up = self.user_points.get(user_id)
            .ok_or("user not found")?;

        if up.points < cost_points {
            return Err("insufficient points".to_string());
        }

        let id = format!("rdm_{}", now_ms());

        let redemption = Redemption {
            id: id.clone(),
            user_id: user_id.to_string(),
            reward_type: reward_type.to_string(),
            cost_points,
            amount,
            status: "pending".to_string(),
        };

        self.redemptions.insert(id.clone(), redemption);

        // Deduct points
        if let Some(up) = self.user_points.get_mut(user_id) {
            up.points -= cost_points;
        }

        Ok(id)
    }

    // Get user points
    pub fn get_points(&self, user_id: &str) -> i64 {
        if let Some(up) = self.user_points.get(user_id) {
            up.points
        } else {
            0
        }
    }

    // Calculate fee discount
    pub fn get_fee_discount(&self, user_id: &str) -> f64 {
        if let Some(tier) = self.get_user_tier(user_id) {
            tier.fee_discount
        } else {
            0.0
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rewards() {
        let mut store = RewardStore::new();
        
        store.add_points("user1", 5000);
        
        assert!(store.get_points("user1") > 0);
    }
}