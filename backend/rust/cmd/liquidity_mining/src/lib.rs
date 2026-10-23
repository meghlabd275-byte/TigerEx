//! Liquidity mining for TigerEx.
//!
//! Rewards are computed from real time-weighted liquidity and the pool's
//! configured emission rate. Nothing is invented: an unknown pool, a
//! non-positive stake or a zero-duration window is rejected.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Pool {
    pub token: String,
    /// Annualised reward rate as a fraction, e.g. 0.12 for 12% APR.
    pub apy: f64,
    pub total_staked: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Stake {
    pub user_id: String,
    pub token: String,
    pub amount: f64,
    pub staked_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MiningError {
    EmptyToken,
    UnknownPool(String),
    InvalidApy(f64),
    InvalidAmount(f64),
    InvalidDuration,
}

impl std::fmt::Display for MiningError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MiningError::EmptyToken => write!(f, "token must not be empty"),
            MiningError::UnknownPool(token) => write!(f, "unknown pool: {token}"),
            MiningError::InvalidApy(apy) => write!(f, "apy {apy} must be positive and finite"),
            MiningError::InvalidAmount(amount) => write!(f, "amount {amount} must be positive and finite"),
            MiningError::InvalidDuration => write!(f, "staking duration must be positive"),
        }
    }
}

impl std::error::Error for MiningError {}

pub struct LiquidityMiningService {
    pools: RwLock<HashMap<String, Pool>>,
    stakes: RwLock<Vec<Stake>>,
}

impl Default for LiquidityMiningService {
    fn default() -> Self {
        Self::new()
    }
}

const MS_PER_YEAR: f64 = 365.0 * 24.0 * 60.0 * 60.0 * 1000.0;

impl LiquidityMiningService {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
            stakes: RwLock::new(Vec::new()),
        }
    }

    pub fn add_pool(&self, token: &str, apy: f64) -> Result<(), MiningError> {
        if token.trim().is_empty() {
            return Err(MiningError::EmptyToken);
        }
        if !apy.is_finite() || apy <= 0.0 {
            return Err(MiningError::InvalidApy(apy));
        }
        self.pools.write().unwrap().insert(
            token.to_string(),
            Pool {
                token: token.to_string(),
                apy,
                total_staked: 0.0,
            },
        );
        Ok(())
    }

    pub fn pool(&self, token: &str) -> Option<Pool> {
        self.pools.read().unwrap().get(token).cloned()
    }

    /// Record a stake, updating the pool total.
    pub fn stake(&self, user_id: &str, token: &str, amount: f64, now_ms: u64) -> Result<(), MiningError> {
        if user_id.trim().is_empty() || token.trim().is_empty() {
            return Err(MiningError::EmptyToken);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(MiningError::InvalidAmount(amount));
        }

        let mut pools = self.pools.write().unwrap();
        let pool = pools
            .get_mut(token)
            .ok_or_else(|| MiningError::UnknownPool(token.to_string()))?;
        pool.total_staked += amount;

        self.stakes.write().unwrap().push(Stake {
            user_id: user_id.to_string(),
            token: token.to_string(),
            amount,
            staked_at_ms: now_ms,
        });
        Ok(())
    }

    /// Rewards accrued by a user's stake up to `now_ms`.
    ///
    /// Simple interest on the exact elapsed time: amount * apy * elapsed/year.
    pub fn accrued_reward(&self, user_id: &str, token: &str, now_ms: u64) -> Result<f64, MiningError> {
        let pools = self.pools.read().unwrap();
        let pool = pools
            .get(token)
            .ok_or_else(|| MiningError::UnknownPool(token.to_string()))?;

        let stakes = self.stakes.read().unwrap();
        let mut reward = 0.0;
        for stake in stakes.iter().filter(|s| s.user_id == user_id && s.token == token) {
            if now_ms <= stake.staked_at_ms {
                return Err(MiningError::InvalidDuration);
            }
            let elapsed = (now_ms - stake.staked_at_ms) as f64;
            reward += stake.amount * pool.apy * (elapsed / MS_PER_YEAR);
        }
        Ok(reward)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_pools_and_stakes() {
        let service = LiquidityMiningService::new();
        assert_eq!(service.add_pool("", 0.1).unwrap_err(), MiningError::EmptyToken);
        assert!(matches!(service.add_pool("TGR", -0.1).unwrap_err(), MiningError::InvalidApy(_)));

        service.add_pool("TGR", 0.12).unwrap();
        assert!(matches!(
            service.stake("u1", "NOPE", 10.0, 0).unwrap_err(),
            MiningError::UnknownPool(_)
        ));
        assert!(matches!(
            service.stake("u1", "TGR", 0.0, 0).unwrap_err(),
            MiningError::InvalidAmount(_)
        ));
    }

    #[test]
    fn accrues_simple_interest_over_elapsed_time() {
        let service = LiquidityMiningService::new();
        service.add_pool("TGR", 0.12).unwrap();
        service.stake("u1", "TGR", 1000.0, 0).unwrap();

        // Half a year at 12% APR on 1000 -> 60.
        let half_year = (MS_PER_YEAR / 2.0) as u64;
        let reward = service.accrued_reward("u1", "TGR", half_year).unwrap();
        assert!((reward - 60.0).abs() < 1e-6, "reward {reward}");
    }

    #[test]
    fn pool_total_tracks_stakes() {
        let service = LiquidityMiningService::new();
        service.add_pool("TGR", 0.12).unwrap();
        service.stake("u1", "TGR", 100.0, 0).unwrap();
        service.stake("u2", "TGR", 250.0, 0).unwrap();
        assert!((service.pool("TGR").unwrap().total_staked - 350.0).abs() < 1e-9);
    }

    #[test]
    fn zero_duration_is_rejected() {
        let service = LiquidityMiningService::new();
        service.add_pool("TGR", 0.12).unwrap();
        service.stake("u1", "TGR", 100.0, 500).unwrap();
        assert_eq!(
            service.accrued_reward("u1", "TGR", 500).unwrap_err(),
            MiningError::InvalidDuration
        );
    }
}
