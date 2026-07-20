//! TigerEx Staking Service - Rust

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Staking pool
#[derive(Debug, Clone)]
pub struct Pool {
    pub asset: String,
    pub total_staked: f64,
    pub reward_rate: f64,
    pub lock_period: u64,
    pub min_stake: f64,
}

/// Stake position
#[derive(Debug, Clone)]
pub struct Stake {
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub start_time: u64,
    pub rewards_earned: f64,
}

/// Staking service
pub struct StakingService {
    pools: RwLock<HashMap<String, Pool>>,
    stakes: RwLock<HashMap<String, Vec<Stake>>>,
}

impl StakingService {
    pub fn new() -> Self {
        let svc = Self {
            pools: RwLock::new(HashMap::new()),
            stakes: RwLock::new(HashMap::new()),
        };
        // ETH pool
        svc.pools.write().unwrap().insert("ETH".to_string(), Pool {
            asset: "ETH".to_string(),
            total_staked: 0.0,
            reward_rate: 0.05,
            lock_period: 86400 * 30,
            min_stake: 0.1,
        });
        svc
    }

    pub fn stake(&self, user_id: &str, asset: &str, amount: f64) -> Result<(), String> {
        let pools = self.pools.read().unwrap();
        let pool = pools.get(asset).ok_or("Pool not found")?;
        if amount < pool.min_stake { return Err("Below minimum".to_string()); }
        
        let stake = Stake { user_id: user_id.to_string(), asset: asset.to_string(), amount, start_time: current_timestamp(), rewards_earned: 0.0 };
        
        let mut stakes = self.stakes.write().unwrap();
        stakes.entry(user_id.to_string()).or_insert_with(Vec::new).push(stake);
        Ok(())
    }

    pub fn unstake(&self, user_id: &str, asset: &str) -> Result<f64, String> {
        let mut stakes = self.stakes.write().unwrap();
        if let Some(user_stakes) = stakes.get_mut(user_id) {
            if let Some(pos) = user_stakes.iter().position(|s| s.asset == asset) {
                let stake = user_stakes.remove(pos);
                return Ok(stake.amount);
            }
        }
        Err("No stake found".to_string())
    }

    pub fn claim_rewards(&self, user_id: &str) -> Result<f64, String> {
        let mut stakes = self.stakes.write().unwrap();
        if let Some(user_stakes) = stakes.get_mut(user_id) {
            let total: f64 = user_stakes.iter_mut().map(|s| { let r = s.rewards_earned; s.rewards_earned = 0.0; r }).sum();
            Ok(total)
        } else { Err("No stakes".to_string()) }
    }
}

impl Default for StakingService { fn default() -> Self { Self::new() } }

fn current_timestamp() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

#[cfg(test)] mod tests { use super::*; #[test] fn test_stake() { let s = StakingService::new(); s.stake("u1", "ETH", 1.0).unwrap(); } }