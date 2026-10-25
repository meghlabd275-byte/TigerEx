//! Dollar-cost-averaging plans.
//!
//! The previous implementation derived the position id from the interval count
//! (`format!("dca_{intervals}")`), so starting a second plan with the same
//! number of intervals overwrote the first, ignored `user_id`, accepted a
//! negative or NaN amount, and let `execute_step` run past the configured
//! number of intervals.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct DCAPosition {
    pub id: String,
    pub user_id: String,
    pub asset: String,
    pub amount: f64,
    pub intervals: u32,
    pub purchased: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DCAError {
    InvalidAmount(f64),
    InvalidIntervals(u32),
    EmptyAsset,
    UnknownPosition(String),
    Complete(String),
}

impl std::fmt::Display for DCAError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DCAError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            DCAError::InvalidIntervals(n) => write!(f, "intervals {n} must be greater than zero"),
            DCAError::EmptyAsset => write!(f, "asset must not be empty"),
            DCAError::UnknownPosition(id) => write!(f, "unknown position: {id}"),
            DCAError::Complete(id) => write!(f, "position {id} has already completed"),
        }
    }
}

impl std::error::Error for DCAError {}

pub struct DCAService {
    positions: RwLock<HashMap<String, DCAPosition>>,
    next_id: RwLock<u64>,
}

impl DCAService {
    pub fn new() -> Self {
        Self {
            positions: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Start a DCA plan. Each plan gets a unique id regardless of its size.
    pub fn start(
        &self,
        user_id: &str,
        asset: &str,
        amount: f64,
        intervals: u32,
    ) -> Result<String, DCAError> {
        if asset.trim().is_empty() {
            return Err(DCAError::EmptyAsset);
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(DCAError::InvalidAmount(amount));
        }
        if intervals == 0 {
            return Err(DCAError::InvalidIntervals(intervals));
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("dca_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.positions.write().unwrap().insert(
            id.clone(),
            DCAPosition {
                id: id.clone(),
                user_id: user_id.to_string(),
                asset: asset.to_string(),
                amount,
                intervals,
                purchased: 0,
            },
        );
        Ok(id)
    }

    /// Execute one interval, returning the updated position.
    pub fn execute_step(&self, pos_id: &str) -> Result<DCAPosition, DCAError> {
        let mut positions = self.positions.write().unwrap();
        let position = positions
            .get_mut(pos_id)
            .ok_or_else(|| DCAError::UnknownPosition(pos_id.to_string()))?;

        if position.purchased >= position.intervals {
            return Err(DCAError::Complete(pos_id.to_string()));
        }
        position.purchased += 1;
        Ok(position.clone())
    }

    /// Total amount purchased so far for a position.
    pub fn total_purchased(&self, pos_id: &str) -> Result<f64, DCAError> {
        self.positions
            .read()
            .unwrap()
            .get(pos_id)
            .map(|p| p.amount * p.purchased as f64)
            .ok_or_else(|| DCAError::UnknownPosition(pos_id.to_string()))
    }

    pub fn get(&self, pos_id: &str) -> Option<DCAPosition> {
        self.positions.read().unwrap().get(pos_id).cloned()
    }

    pub fn plans_for(&self, user_id: &str) -> Vec<DCAPosition> {
        self.positions
            .read()
            .unwrap()
            .values()
            .filter(|p| p.user_id == user_id)
            .cloned()
            .collect()
    }
}

impl Default for DCAService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_with_the_same_interval_count_do_not_collide() {
        let svc = DCAService::new();
        let first = svc.start("alice", "BTC", 100.0, 30).unwrap();
        let second = svc.start("bob", "ETH", 200.0, 30).unwrap();

        // The old implementation produced "dca_30" for both, overwriting one.
        assert_ne!(first, second);
        assert_eq!(svc.get(&first).unwrap().user_id, "alice");
        assert_eq!(svc.get(&second).unwrap().user_id, "bob");
    }

    #[test]
    fn invalid_parameters_are_rejected() {
        let svc = DCAService::new();
        assert!(svc.start("alice", "BTC", -1.0, 30).is_err());
        assert!(svc.start("alice", "BTC", f64::NAN, 30).is_err());
        assert!(svc.start("alice", "BTC", 100.0, 0).is_err());
        assert!(svc.start("alice", "  ", 100.0, 30).is_err());
    }

    #[test]
    fn steps_stop_at_the_configured_interval_count() {
        let svc = DCAService::new();
        let id = svc.start("alice", "BTC", 100.0, 3).unwrap();

        svc.execute_step(&id).unwrap();
        svc.execute_step(&id).unwrap();
        svc.execute_step(&id).unwrap();
        assert_eq!(svc.get(&id).unwrap().purchased, 3);

        // The old implementation incremented past the interval count forever.
        assert_eq!(
            svc.execute_step(&id).unwrap_err(),
            DCAError::Complete(id.clone())
        );
        assert_eq!(svc.total_purchased(&id).unwrap(), 300.0);
    }

    #[test]
    fn unknown_positions_are_rejected() {
        let svc = DCAService::new();
        assert!(svc.execute_step("dca_missing").is_err());
        assert!(svc.total_purchased("dca_missing").is_err());
    }

    #[test]
    fn plans_are_scoped_to_their_owner() {
        let svc = DCAService::new();
        svc.start("alice", "BTC", 100.0, 5).unwrap();
        svc.start("bob", "BTC", 100.0, 5).unwrap();

        assert_eq!(svc.plans_for("alice").len(), 1);
        assert_eq!(svc.plans_for("nobody").len(), 0);
    }
}
