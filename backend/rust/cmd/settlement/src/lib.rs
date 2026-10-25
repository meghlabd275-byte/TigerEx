//! Real-time settlement between accounts.
//!
//! The previous implementation recorded a settlement request but never moved
//! any balance, accepted any amount including negative and NaN, and derived the
//! id from the millisecond clock so two settlements in the same millisecond
//! collided. `settle_instant` also left the entry in the pending list, so the
//! same settlement could be "settled" repeatedly.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq)]
pub struct Settlement {
    pub id: String,
    pub from_user: String,
    pub to_user: String,
    pub asset: String,
    pub amount: f64,
    pub timestamp: u64,
    pub status: SettlementStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettlementStatus {
    Pending,
    Settled,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SettlementError {
    InvalidAmount(f64),
    SelfTransfer,
    InsufficientBalance { available: f64 },
    UnknownSettlement(String),
    NotPending(String),
}

impl std::fmt::Display for SettlementError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettlementError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            SettlementError::SelfTransfer => write!(f, "sender and recipient must differ"),
            SettlementError::InsufficientBalance { available } => {
                write!(f, "insufficient balance: {available} available")
            }
            SettlementError::UnknownSettlement(id) => write!(f, "unknown settlement: {id}"),
            SettlementError::NotPending(id) => write!(f, "settlement {id} is not pending"),
        }
    }
}

impl std::error::Error for SettlementError {}

pub struct SettlementService {
    pending: RwLock<Vec<Settlement>>,
    settled: RwLock<Vec<Settlement>>,
    /// user -> asset -> available balance.
    balances: RwLock<HashMap<String, HashMap<String, f64>>>,
    settlement_time_ms: u32,
    next_id: RwLock<u64>,
}

impl SettlementService {
    pub fn new() -> Self {
        Self {
            pending: RwLock::new(Vec::new()),
            settled: RwLock::new(Vec::new()),
            balances: RwLock::new(HashMap::new()),
            settlement_time_ms: 50,
            next_id: RwLock::new(1),
        }
    }

    pub fn settlement_time_ms(&self) -> u32 {
        self.settlement_time_ms
    }

    /// Credit a user's settlement balance.
    pub fn deposit(&self, user_id: &str, asset: &str, amount: f64) -> Result<(), SettlementError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(SettlementError::InvalidAmount(amount));
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
            .and_then(|assets| assets.get(asset))
            .copied()
            .unwrap_or(0.0)
    }

    /// Initiate a settlement. The sender's balance is reserved immediately so
    /// the same funds cannot back two settlements.
    pub fn initiate(
        &self,
        from: &str,
        to: &str,
        asset: &str,
        amount: f64,
    ) -> Result<String, SettlementError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(SettlementError::InvalidAmount(amount));
        }
        if from == to {
            return Err(SettlementError::SelfTransfer);
        }

        {
            let mut balances = self.balances.write().unwrap();
            let available = balances
                .get(from)
                .and_then(|assets| assets.get(asset))
                .copied()
                .unwrap_or(0.0);
            if available < amount {
                return Err(SettlementError::InsufficientBalance { available });
            }
            *balances
                .get_mut(from)
                .expect("balance checked above")
                .get_mut(asset)
                .expect("asset checked above") -= amount;
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("stl_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.pending.write().unwrap().push(Settlement {
            id: id.clone(),
            from_user: from.to_string(),
            to_user: to.to_string(),
            asset: asset.to_string(),
            amount,
            timestamp: current_timestamp(),
            status: SettlementStatus::Pending,
        });
        Ok(id)
    }

    /// Settle a pending transfer, crediting the recipient.
    pub fn settle_instant(&self, settlement_id: &str) -> Result<Settlement, SettlementError> {
        let settlement = {
            let mut pending = self.pending.write().unwrap();
            let pos = pending
                .iter()
                .position(|s| s.id == settlement_id)
                .ok_or_else(|| SettlementError::UnknownSettlement(settlement_id.to_string()))?;
            let mut settlement = pending.remove(pos);
            settlement.status = SettlementStatus::Settled;
            settlement
        };

        *self
            .balances
            .write()
            .unwrap()
            .entry(settlement.to_user.clone())
            .or_default()
            .entry(settlement.asset.clone())
            .or_insert(0.0) += settlement.amount;

        self.settled.write().unwrap().push(settlement.clone());
        Ok(settlement)
    }

    /// Cancel a pending settlement, returning the reserved funds to the sender.
    pub fn cancel(&self, settlement_id: &str) -> Result<Settlement, SettlementError> {
        let settlement = {
            let mut pending = self.pending.write().unwrap();
            let pos = pending
                .iter()
                .position(|s| s.id == settlement_id)
                .ok_or_else(|| SettlementError::UnknownSettlement(settlement_id.to_string()))?;
            let mut settlement = pending.remove(pos);
            settlement.status = SettlementStatus::Failed;
            settlement
        };

        *self
            .balances
            .write()
            .unwrap()
            .entry(settlement.from_user.clone())
            .or_default()
            .entry(settlement.asset.clone())
            .or_insert(0.0) += settlement.amount;
        Ok(settlement)
    }

    pub fn pending_count(&self) -> usize {
        self.pending.read().unwrap().len()
    }

    pub fn settled_count(&self) -> usize {
        self.settled.read().unwrap().len()
    }
}

impl Default for SettlementService {
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

    #[test]
    fn settlement_moves_the_balance() {
        let svc = SettlementService::new();
        svc.deposit("alice", "USDT", 1_000.0).unwrap();

        let id = svc.initiate("alice", "bob", "USDT", 400.0).unwrap();
        // Funds are reserved on initiation.
        assert_eq!(svc.balance("alice", "USDT"), 600.0);

        let settlement = svc.settle_instant(&id).unwrap();
        assert_eq!(settlement.status, SettlementStatus::Settled);
        assert_eq!(svc.balance("bob", "USDT"), 400.0);
        assert_eq!(svc.pending_count(), 0);
        assert_eq!(svc.settled_count(), 1);
    }

    #[test]
    fn invalid_amounts_are_rejected() {
        let svc = SettlementService::new();
        svc.deposit("alice", "USDT", 1_000.0).unwrap();

        // The old implementation accepted all of these and moved no balance.
        assert!(svc.initiate("alice", "bob", "USDT", -1.0).is_err());
        assert!(svc.initiate("alice", "bob", "USDT", f64::NAN).is_err());
        assert!(svc.initiate("alice", "alice", "USDT", 1.0).is_err());
        assert_eq!(svc.pending_count(), 0);
    }

    #[test]
    fn overspending_is_rejected() {
        let svc = SettlementService::new();
        svc.deposit("alice", "USDT", 100.0).unwrap();

        assert!(matches!(
            svc.initiate("alice", "bob", "USDT", 150.0).unwrap_err(),
            SettlementError::InsufficientBalance { .. }
        ));
        assert_eq!(svc.balance("alice", "USDT"), 100.0);
    }

    #[test]
    fn a_settlement_can_only_be_settled_once() {
        let svc = SettlementService::new();
        svc.deposit("alice", "USDT", 100.0).unwrap();
        let id = svc.initiate("alice", "bob", "USDT", 100.0).unwrap();

        svc.settle_instant(&id).unwrap();
        // The old implementation left the entry pending, so this double-paid.
        assert!(svc.settle_instant(&id).is_err());
        assert_eq!(svc.balance("bob", "USDT"), 100.0);
    }

    #[test]
    fn cancelling_returns_the_reserved_funds() {
        let svc = SettlementService::new();
        svc.deposit("alice", "USDT", 100.0).unwrap();
        let id = svc.initiate("alice", "bob", "USDT", 100.0).unwrap();
        assert_eq!(svc.balance("alice", "USDT"), 0.0);

        svc.cancel(&id).unwrap();
        assert_eq!(svc.balance("alice", "USDT"), 100.0);
        assert_eq!(svc.balance("bob", "USDT"), 0.0);
        assert_eq!(svc.pending_count(), 0);
    }

    #[test]
    fn ids_are_unique_within_a_millisecond() {
        let svc = SettlementService::new();
        svc.deposit("alice", "USDT", 1_000.0).unwrap();

        let a = svc.initiate("alice", "bob", "USDT", 1.0).unwrap();
        let b = svc.initiate("alice", "bob", "USDT", 1.0).unwrap();
        // The old id was the millisecond clock, so these collided.
        assert_ne!(a, b);
        assert_eq!(svc.pending_count(), 2);
    }
}
