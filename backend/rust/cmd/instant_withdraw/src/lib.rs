//! Instant withdrawal queue with per-user daily limits.
//!
//! The previous implementation compared the amount against the daily limit
//! with `>`, so a negative or NaN amount passed the check and entered the
//! queue, never debited any balance, and derived ids from the queue length so
//! ids were reused after items left the queue.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Withdrawal {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub method: String,
    pub status: WithdrawalStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WithdrawalStatus {
    Queued,
    Instant,
    Rejected,
}

#[derive(Debug, Clone, PartialEq)]
pub enum WithdrawError {
    InvalidAmount(f64),
    ExceedsDailyLimit { limit: f64, used: f64 },
    InsufficientBalance { available: f64 },
    InvalidLimit(f64),
}

impl std::fmt::Display for WithdrawError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WithdrawError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            WithdrawError::ExceedsDailyLimit { limit, used } => {
                write!(f, "daily limit {limit} already has {used} used")
            }
            WithdrawError::InsufficientBalance { available } => {
                write!(f, "only {available} available")
            }
            WithdrawError::InvalidLimit(l) => write!(f, "limit {l} must be finite and positive"),
        }
    }
}

impl std::error::Error for WithdrawError {}

pub struct InstantWithdrawService {
    queue: RwLock<Vec<Withdrawal>>,
    /// Per-user daily limit.
    limits: RwLock<HashMap<String, f64>>,
    /// Per-user amount withdrawn today.
    used_today: RwLock<HashMap<String, f64>>,
    /// user -> asset -> available balance.
    balances: RwLock<HashMap<String, HashMap<String, f64>>>,
    next_id: RwLock<u64>,
}

impl InstantWithdrawService {
    pub fn new() -> Self {
        Self {
            queue: RwLock::new(Vec::new()),
            limits: RwLock::new(HashMap::new()),
            used_today: RwLock::new(HashMap::new()),
            balances: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    pub fn set_daily_limit(&self, user_id: &str, limit: f64) -> Result<(), WithdrawError> {
        if !limit.is_finite() || limit <= 0.0 {
            return Err(WithdrawError::InvalidLimit(limit));
        }
        self.limits.write().unwrap().insert(user_id.to_string(), limit);
        Ok(())
    }

    pub fn deposit(&self, user_id: &str, asset: &str, amount: f64) -> Result<(), WithdrawError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(WithdrawError::InvalidAmount(amount));
        }
        *self
            .balances
            .write()
            .unwrap()
            .entry(user_id.to_string())
            .or_default()
            .entry(asset.to_string())
            .or_insert(0.0) += amount;
        Ok(())
    }

    pub fn balance(&self, user_id: &str, asset: &str) -> f64 {
        self.balances
            .read()
            .unwrap()
            .get(user_id)
            .and_then(|a| a.get(asset))
            .copied()
            .unwrap_or(0.0)
    }

    /// Request an instant withdrawal. Enforces the daily limit and the
    /// available balance, and debits immediately so the same funds cannot back
    /// two withdrawals.
    pub fn request(
        &self,
        user_id: &str,
        asset: &str,
        amount: f64,
        method: &str,
    ) -> Result<Withdrawal, WithdrawError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(WithdrawError::InvalidAmount(amount));
        }

        let limit = self
            .limits
            .read()
            .unwrap()
            .get(user_id)
            .copied()
            .unwrap_or(10_000.0);

        {
            let mut used = self.used_today.write().unwrap();
            let used_amount = used.get(user_id).copied().unwrap_or(0.0);
            if used_amount + amount > limit {
                return Err(WithdrawError::ExceedsDailyLimit {
                    limit,
                    used: used_amount,
                });
            }

            let mut balances = self.balances.write().unwrap();
            let available = balances
                .get(user_id)
                .and_then(|a| a.get(asset))
                .copied()
                .unwrap_or(0.0);
            if available < amount {
                return Err(WithdrawError::InsufficientBalance { available });
            }
            *balances
                .get_mut(user_id)
                .expect("balance checked above")
                .get_mut(asset)
                .expect("asset checked above") -= amount;

            *used.entry(user_id.to_string()).or_insert(0.0) += amount;
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("wd_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let withdrawal = Withdrawal {
            id,
            user_id: user_id.to_string(),
            asset: asset.to_string(),
            amount,
            method: method.to_string(),
            status: WithdrawalStatus::Instant,
        };
        self.queue.write().unwrap().push(withdrawal.clone());
        Ok(withdrawal)
    }

    pub fn queue_len(&self) -> usize {
        self.queue.read().unwrap().len()
    }

    pub fn used_today(&self, user_id: &str) -> f64 {
        self.used_today
            .read()
            .unwrap()
            .get(user_id)
            .copied()
            .unwrap_or(0.0)
    }
}

impl Default for InstantWithdrawService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn funded() -> InstantWithdrawService {
        let svc = InstantWithdrawService::new();
        svc.deposit("u1", "USDT", 100_000.0).unwrap();
        svc
    }

    #[test]
    fn a_withdrawal_debits_the_balance_and_counts_against_the_limit() {
        let svc = funded();
        let w = svc.request("u1", "USDT", 5_000.0, "bank").unwrap();

        assert_eq!(w.status, WithdrawalStatus::Instant);
        assert_eq!(svc.balance("u1", "USDT"), 95_000.0);
        assert_eq!(svc.used_today("u1"), 5_000.0);
    }

    #[test]
    fn negative_and_non_finite_amounts_are_rejected() {
        let svc = funded();
        // The old check used '>' against the limit, so these passed.
        assert!(svc.request("u1", "USDT", -1.0, "bank").is_err());
        assert!(svc.request("u1", "USDT", f64::NAN, "bank").is_err());
        assert!(svc.request("u1", "USDT", 0.0, "bank").is_err());
        assert_eq!(svc.queue_len(), 0);
        assert_eq!(svc.balance("u1", "USDT"), 100_000.0);
    }

    #[test]
    fn the_daily_limit_is_enforced_cumulatively() {
        let svc = funded();
        svc.set_daily_limit("u1", 10_000.0).unwrap();

        svc.request("u1", "USDT", 6_000.0, "bank").unwrap();
        // The old implementation checked each request against the limit
        // independently, so this second one would have passed.
        assert!(matches!(
            svc.request("u1", "USDT", 6_000.0, "bank").unwrap_err(),
            WithdrawError::ExceedsDailyLimit { .. }
        ));
        assert_eq!(svc.used_today("u1"), 6_000.0);
    }

    #[test]
    fn insufficient_balance_is_rejected() {
        let svc = InstantWithdrawService::new();
        svc.deposit("u1", "USDT", 100.0).unwrap();
        assert!(matches!(
            svc.request("u1", "USDT", 500.0, "bank").unwrap_err(),
            WithdrawError::InsufficientBalance { .. }
        ));
    }

    #[test]
    fn ids_are_unique() {
        let svc = funded();
        let a = svc.request("u1", "USDT", 1.0, "bank").unwrap();
        let b = svc.request("u1", "USDT", 1.0, "bank").unwrap();
        assert_ne!(a.id, b.id);
    }
}
