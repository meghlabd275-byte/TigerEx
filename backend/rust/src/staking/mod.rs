// TIGEREX STAKING MODULE - RUST
// Proof-of-stake delegation and rewards

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct Validator {
    pub id: String,
    pub name: String,
    pub commission: f64,
    pub uptime: f64,
    pub delegated_stake: f64,
    pub status: String,
}

#[derive(Clone)]
pub struct Delegation {
    pub delegator_id: String,
    pub validator_id: String,
    pub amount: f64,
    pub claimed_rewards: f64,
    pub started_at: u64,
}

#[derive(Clone)]
pub struct StakePool {
    pub id: String,
    pub symbol: String,
    pub total_staked: f64,
    pub rewards_pool: f64,
    pub apy: f64,
    pub min_stake: f64,
    pub lock_period: u64,
}

pub struct StakingService {
    validators: Arc<RwLock<HashMap<String, Validator>>>,
    delegations: Arc<RwLock<HashMap<String, Delegation>>>,
    pools: Arc<RwLock<HashMap<String, StakePool>>>,
}

impl StakingService {
    pub fn new() -> Self {
        let service = Self {
            validators: Arc::new(RwLock::new(HashMap::new())),
            delegations: Arc::new(RwLock::new(HashMap::new())),
            pools: Arc::new(RwLock::new(HashMap::new())),
        };
        service.add_validator("val_1", "TigerValidator 1", 0.02, 0.999);
        service.add_validator("val_2", "TigerValidator 2", 0.03, 0.998);
        service.add_pool("btc_stake", "BTC", 0.05);
        service.add_pool("eth_stake", "ETH", 0.045);
        service
    }

    fn add_validator(&self, id: &str, name: &str, commission: f64, uptime: f64) {
        let validator = Validator {
            id: id.to_string(),
            name: name.to_string(),
            commission,
            uptime,
            delegated_stake: 0.0,
            status: "active".to_string(),
        };
        self.validators.write().unwrap().insert(id.to_string(), validator);
    }

    fn add_pool(&self, id: &str, symbol: &str, apy: f64) {
        let pool = StakePool {
            id: id.to_string(),
            symbol: symbol.to_string(),
            total_staked: 0.0,
            rewards_pool: 1000000.0,
            apy,
            min_stake: 0.01,
            lock_period: 86400 * 14,
        };
        self.pools.write().unwrap().insert(id.to_string(), pool);
    }

    pub fn delegate(&self, delegator_id: &str, validator_id: &str, amount: f64) -> Result<Delegation, String> {
        let delegation = Delegation {
            delegator_id: delegator_id.to_string(),
            validator_id: validator_id.to_string(),
            amount,
            claimed_rewards: 0.0,
            started_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        };
        
        let key = format!("{}_{}", delegator_id, validator_id);
        self.delegations.write().unwrap().insert(key, delegation.clone());
        Ok(delegation)
    }

    pub fn undelegate(&self, delegator_id: &str, validator_id: &str) -> Result<f64, String> {
        let key = format!("{}_{}", delegator_id, validator_id);
        if let Some(d) = self.delegations.write().unwrap().remove(&key) {
            return Ok(d.amount);
        }
        Err("Delegation not found".to_string())
    }

    pub fn claim_rewards(&self, delegator_id: &str, validator_id: &str) -> Result<f64, String> {
        let key = format!("{}_{}", delegator_id, validator_id);
        if let Some(d) = self.delegations.write().unwrap().get_mut(&key) {
            let rewards = d.amount * 0.05;
            d.claimed_rewards += rewards;
            return Ok(rewards);
        }
        Err("Delegation not found".to_string())
    }

    pub fn get_validators(&self) -> Vec<Validator> {
        self.validators.read().unwrap().values().cloned().collect()
    }

    pub fn get_pools(&self) -> Vec<StakePool> {
        self.pools.read().unwrap().values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_delegation() {
        let service = StakingService::new();
        let result = service.delegate("user1", "val_1", 1.0);
        assert!(result.is_ok());
    }
}