//! Staking Service - Rust Implementation
//! 
//! Proof-of-stake, delegations, rewards

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Stake position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakePosition {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub apy: f64,
    pub lock_period: u64,  // days
    pub started_at: i64,
    pub accrued_rewards: f64,
}

/// Delegation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delegation {
    pub delegator_id: String,
    pub validator_id: String,
    pub amount: f64,
    pub rewards: f64,
}

/// Staking pool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakingPool {
    pub asset: String,
    pub total_staked: f64,
    pub apy: f64,
    pub validators: Vec<String>,
    pub min_stake: f64,
    pub lock_period_days: u64,
    pub early_unstake_penalty: f64,
}

/// Reward schedule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardSchedule {
    pub period: u64,  // days
    pub reward_rate: f64,
}

pub struct StakingService {
    pools: HashMap<String, StakingPool>,
    stakes: HashMap<String, StakePosition>,
    delegations: HashMap<String, Vec<Delegation>>,
    schedules: Vec<RewardSchedule>,
}

impl StakingService {
    pub fn new() -> Self {
        let mut service = Self {
            pools: HashMap::new(),
            stakes: HashMap::new(),
            delegations: HashMap::new(),
            schedules: Vec::new(),
        };
        
        // Initialize ETH pool
        service.pools.insert("ETH".to_string(), StakingPool {
            asset: "ETH".to_string(),
            total_staked: 0.0,
            apy: 0.05, // 5% APY
            validators: vec!["validator_1".to_string()],
            min_stake: 0.1,
            lock_period_days: 365,
            early_unstake_penalty: 0.1,
        });

        // Initialize DOT pool
        service.pools.insert("DOT".to_string(), StakingPool {
            asset: "DOT".to_string(),
            total_staked: 0.0,
            apy: 0.12,
            validators: vec!["validator_1".to_string(), "validator_2".to_string()],
            min_stake: 1.0,
            lock_period_days: 28,
            early_unstake_penalty: 0.05,
        });

        // Initialize SOL pool
        service.pools.insert("SOL".to_string(), StakingPool {
            asset: "SOL".to_string(),
            total_staked: 0.0,
            apy: 0.08,
            validators: vec!["validator_1".to_string()],
            min_stake: 0.1,
            lock_period_days: 365,
            early_unstake_penalty: 0.1,
        });

        service
    }

    /// Get pool
    pub fn get_pool(&self, asset &str) -> Option<&StakingPool> {
        self.pools.get(asset)
    }

    /// Stake
    pub fn stake(&mut self, user_id: &str, asset: &str, amount: f64) -> Result<StakePosition, String> {
        let pool = self.pools.get_mut(asset)
            .ok_or("Asset not found")?;

        if amount < pool.min_stake {
            return Err(format!("Minimum stake is {}", pool.min_stake));
        }

        let position = StakePosition {
            id: format!("stake_{}", current_timestamp_ms()),
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            apy: pool.apy,
            lock_period: pool.lock_period_days,
            started_at: current_timestamp_ms(),
            accrued_rewards: 0.0,
        };

        pool.total_staked += amount;
        self.stakes.insert(position.id.clone(), position.clone());

        Ok(position)
    }

    /// Calculate rewards
    pub fn calculate_rewards(&self, stake_id: &str, days: f64) -> f64 {
        let stake = match self.stakes.get(stake_id) {
            Some(s) => s,
            None => return 0.0,
        };

        (stake.amount * stake.apy * days) / 365.0
    }

    /// Claim rewards
    pub fn claim_rewards(&mut self, stake_id: &str) -> Result<f64, String> {
        let stake = self.stakes.get_mut(stake_id)
            .ok_or("Stake not found")?;

        let now = current_timestamp_ms();
        let days = ((now - stake.started_at) / 86400000) as f64;
        
        let rewards = stake.accrued_rewards + self.calculate_rewards(stake_id, days);
        stake.accrued_rewards = 0.0;
        stake.started_at = now;

        Ok(rewards)
    }

    /// Unstake
    pub fn unstake(&mut self, stake_id: &str) -> Result<f64, String> {
        let stake = self.stakes.get(stake_id)
            .ok_or("Stake not found")?;

        let pool = self.pools.get_mut(&stake.asset)
            .ok_or("Pool not found")?;

        let now = current_timestamp_ms();
        let days = ((now - stake.started_at) / 86400000) as f64;

        // Check lock period
        if days < stake.lock_period as f64 {
            let penalty = stake.amount * pool.early_unstake_penalty;
            pool.total_staked -= stake.amount;
            self.stakes.remove(stake_id);
            return Err(format!("Early unstake penalty: {}", penalty));
        }

        let rewards = self.calculate_rewards(stake_id, days);
        pool.total_staked -= stake.amount;
        
        self.stakes.remove(stake_id);
        
        Ok(stake.amount + rewards)
    }

    /// Get user stakes
    pub fn get_user_stakes(&self, user_id: &str) -> Vec<&StakePosition> {
        self.stakes.values()
            .filter(|s| s.user_id == user_id)
            .collect()
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
    fn test_stake() {
        let mut service = StakingService::new();
        let result = service.stake("user1", "ETH", 1.0);
        assert!(result.is_ok());
    }
}