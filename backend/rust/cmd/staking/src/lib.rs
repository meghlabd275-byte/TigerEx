//! Staking pools with time-based reward accrual.
//!
//! The previous implementation never accrued rewards (`claim_rewards` always
//! returned zero because `rewards_earned` was only ever initialised), ignored
//! the pool's `lock_period` so any stake could be withdrawn immediately, never
//! updated `total_staked`, and accepted any amount because the minimum-stake
//! check used `<` against a NaN amount.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Seconds in a year, for converting an annual rate to a per-second rate.
const SECONDS_PER_YEAR: f64 = 365.0 * 24.0 * 60.0 * 60.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Pool {
    pub asset: String,
    pub total_staked: f64,
    /// Annual reward rate as a fraction, e.g. 0.05 for 5% APY.
    pub reward_rate: f64,
    /// Minimum lock duration in seconds.
    pub lock_period: u64,
    pub min_stake: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Stake {
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub start_time: u64,
    pub rewards_earned: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StakingError {
    PoolNotFound(String),
    InvalidAmount(f64),
    BelowMinimum { required: f64 },
    NoStake(String),
    StillLocked { seconds_remaining: u64 },
}

impl std::fmt::Display for StakingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StakingError::PoolNotFound(a) => write!(f, "no staking pool for {a}"),
            StakingError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            StakingError::BelowMinimum { required } => {
                write!(f, "amount is below the {required} minimum")
            }
            StakingError::NoStake(a) => write!(f, "no stake found for {a}"),
            StakingError::StillLocked { seconds_remaining } => {
                write!(f, "stake is still locked for {seconds_remaining} more seconds")
            }
        }
    }
}

impl std::error::Error for StakingError {}

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
        svc.create_pool("ETH", 0.05, 30 * 24 * 60 * 60, 0.1).unwrap();
        svc
    }

    /// Create or replace a staking pool.
    pub fn create_pool(
        &self,
        asset: &str,
        reward_rate: f64,
        lock_period: u64,
        min_stake: f64,
    ) -> Result<(), StakingError> {
        if !reward_rate.is_finite() || reward_rate < 0.0 {
            return Err(StakingError::InvalidAmount(reward_rate));
        }
        if !min_stake.is_finite() || min_stake <= 0.0 {
            return Err(StakingError::InvalidAmount(min_stake));
        }
        self.pools.write().unwrap().insert(
            asset.to_string(),
            Pool {
                asset: asset.to_string(),
                total_staked: 0.0,
                reward_rate,
                lock_period,
                min_stake,
            },
        );
        Ok(())
    }

    /// Stake into a pool. Updates the pool's total and enforces the minimum.
    pub fn stake(&self, user_id: &str, asset: &str, amount: f64) -> Result<(), StakingError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(StakingError::InvalidAmount(amount));
        }

        let mut pools = self.pools.write().unwrap();
        let pool = pools
            .get_mut(asset)
            .ok_or_else(|| StakingError::PoolNotFound(asset.to_string()))?;

        if amount < pool.min_stake {
            return Err(StakingError::BelowMinimum {
                required: pool.min_stake,
            });
        }
        pool.total_staked += amount;
        drop(pools);

        self.stakes
            .write()
            .unwrap()
            .entry(user_id.to_string())
            .or_default()
            .push(Stake {
                user_id: user_id.to_string(),
                asset: asset.to_string(),
                amount,
                start_time: current_timestamp(),
                rewards_earned: 0.0,
            });
        Ok(())
    }

    /// Accrued rewards for one stake, computed from elapsed time.
    fn accrued(pool_rate: f64, stake: &Stake, now: u64) -> f64 {
        // Timestamps are in milliseconds; convert to seconds before applying
        // an annual rate.
        let elapsed_seconds = now.saturating_sub(stake.start_time) as f64 / 1000.0;
        let per_second = pool_rate / SECONDS_PER_YEAR;
        stake.amount * per_second * elapsed_seconds
    }

    /// Unstake, returning the principal plus accrued rewards.
    ///
    /// Fails while the stake is still inside the pool's lock period.
    pub fn unstake(&self, user_id: &str, asset: &str) -> Result<f64, StakingError> {
        let rate = self
            .pools
            .read()
            .unwrap()
            .get(asset)
            .map(|p| (p.reward_rate, p.lock_period))
            .ok_or_else(|| StakingError::PoolNotFound(asset.to_string()))?;
        let (reward_rate, lock_period) = rate;

        let now = current_timestamp();
        let mut stakes = self.stakes.write().unwrap();
        let user_stakes = stakes
            .get_mut(user_id)
            .ok_or_else(|| StakingError::NoStake(asset.to_string()))?;

        let pos = user_stakes
            .iter()
            .position(|s| s.asset == asset)
            .ok_or_else(|| StakingError::NoStake(asset.to_string()))?;

        let unlock_at = user_stakes[pos].start_time.saturating_add(lock_period * 1000);
        if now < unlock_at {
            return Err(StakingError::StillLocked {
                seconds_remaining: (unlock_at - now) / 1000,
            });
        }

        let stake = user_stakes.remove(pos);
        let rewards = Self::accrued(reward_rate, &stake, now);
        drop(stakes);

        if let Some(pool) = self.pools.write().unwrap().get_mut(asset) {
            pool.total_staked = (pool.total_staked - stake.amount).max(0.0);
        }

        Ok(stake.amount + rewards)
    }

    /// Claim accrued rewards without withdrawing principal.
    pub fn claim_rewards(&self, user_id: &str) -> Result<f64, StakingError> {
        let now = current_timestamp();
        let rates: HashMap<String, f64> = self
            .pools
            .read()
            .unwrap()
            .iter()
            .map(|(asset, pool)| (asset.clone(), pool.reward_rate))
            .collect();

        let mut stakes = self.stakes.write().unwrap();
        let user_stakes = stakes
            .get_mut(user_id)
            .ok_or_else(|| StakingError::NoStake(user_id.to_string()))?;

        let mut total = 0.0;
        for stake in user_stakes.iter_mut() {
            let rate = rates.get(&stake.asset).copied().unwrap_or(0.0);
            let rewards = Self::accrued(rate, stake, now);
            stake.rewards_earned += rewards;
            total += rewards;
            // Restart the accrual window so the same time is not paid twice.
            stake.start_time = now;
        }
        Ok(total)
    }

    pub fn pool(&self, asset: &str) -> Option<Pool> {
        self.pools.read().unwrap().get(asset).cloned()
    }

    pub fn stakes_for(&self, user_id: &str) -> Vec<Stake> {
        self.stakes
            .read()
            .unwrap()
            .get(user_id)
            .cloned()
            .unwrap_or_default()
    }
}

impl Default for StakingService {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Backdate a stake so tests can observe accrual without sleeping.
    fn backdate(service: &StakingService, user_id: &str, seconds: u64) {
        let mut stakes = service.stakes.write().unwrap();
        for stake in stakes.get_mut(user_id).unwrap() {
            stake.start_time = stake.start_time.saturating_sub(seconds * 1000);
        }
    }

    #[test]
    fn negative_and_non_finite_stakes_are_rejected() {
        let svc = StakingService::new();
        // The old minimum-stake check used '<', which NaN passes.
        assert!(svc.stake("u1", "ETH", -1.0).is_err());
        assert!(svc.stake("u1", "ETH", f64::NAN).is_err());
        assert!(svc.stake("u1", "ETH", 0.0).is_err());
        assert_eq!(svc.pool("ETH").unwrap().total_staked, 0.0);
    }

    #[test]
    fn staking_updates_the_pool_total_and_enforces_the_minimum() {
        let svc = StakingService::new();
        svc.stake("u1", "ETH", 1.0).unwrap();
        assert_eq!(svc.pool("ETH").unwrap().total_staked, 1.0);

        // The ETH pool minimum is 0.1.
        assert!(matches!(
            svc.stake("u1", "ETH", 0.05).unwrap_err(),
            StakingError::BelowMinimum { .. }
        ));
        assert!(svc.stake("u1", "NOPE", 1.0).is_err());
    }

    #[test]
    fn rewards_accrue_over_time_instead_of_always_being_zero() {
        let svc = StakingService::new();
        svc.stake("u1", "ETH", 1_000.0).unwrap();
        backdate(&svc, "u1", 365 * 24 * 60 * 60);

        // A full year at 5% APY on 1,000 ETH is 50 ETH.
        let rewards = svc.claim_rewards("u1").unwrap();
        assert!((rewards - 50.0).abs() < 1.0, "got {rewards}");

        // Claiming again immediately yields ~nothing, not the same 50.
        let again = svc.claim_rewards("u1").unwrap();
        assert!(again < 1.0, "double claim paid {again}");
    }

    #[test]
    fn unstake_returns_principal_plus_rewards_after_the_lock() {
        let svc = StakingService::new();
        svc.stake("u1", "ETH", 1_000.0).unwrap();

        // The ETH pool locks for 30 days.
        assert!(matches!(
            svc.unstake("u1", "ETH").unwrap_err(),
            StakingError::StillLocked { .. }
        ));

        backdate(&svc, "u1", 31 * 24 * 60 * 60);
        let payout = svc.unstake("u1", "ETH").unwrap();

        assert!(payout > 1_000.0, "principal plus rewards expected");
        assert!(payout < 1_100.0, "one month of 5% APY is well under 10%");
        assert_eq!(svc.pool("ETH").unwrap().total_staked, 0.0);
        assert!(svc.unstake("u1", "ETH").is_err());
    }

    #[test]
    fn claiming_without_stakes_reports_an_error() {
        let svc = StakingService::new();
        assert!(matches!(
            svc.claim_rewards("nobody").unwrap_err(),
            StakingError::NoStake(_)
        ));
    }
}
