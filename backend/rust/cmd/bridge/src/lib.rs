//! Cross-chain bridge accounting.
//!
//! The previous implementation derived the transfer id from the amount
//! (`format!("br_{}", amount)`), so two bridges of the same amount collided
//! and the second overwrote the first, and it accepted any amount.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct BridgeConfig {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    /// Bridge fee as a fraction of the amount.
    pub fee: f64,
    /// Minimum bridgeable amount.
    pub min_amount: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BridgeTransfer {
    pub id: String,
    pub user_id: String,
    pub token: String,
    pub amount: f64,
    pub fee: f64,
    pub received: f64,
    pub status: BridgeStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeStatus {
    Pending,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BridgeError {
    EmptyChain,
    EmptyToken,
    InvalidFee(f64),
    InvalidMinAmount(f64),
    InvalidAmount(f64),
    BelowMinimum { min: f64 },
    DuplicateRoute(String),
    UnknownRoute(String),
    NotPending(String),
    UnknownTransfer(String),
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BridgeError::EmptyChain => write!(f, "chain name must not be empty"),
            BridgeError::EmptyToken => write!(f, "token must not be empty"),
            BridgeError::InvalidFee(fee) => write!(f, "fee {fee} must be finite and within [0, 1)"),
            BridgeError::InvalidMinAmount(m) => write!(f, "minimum amount {m} must be finite and positive"),
            BridgeError::InvalidAmount(a) => write!(f, "amount {a} must be finite and positive"),
            BridgeError::BelowMinimum { min } => write!(f, "amount is below the minimum of {min}"),
            BridgeError::DuplicateRoute(r) => write!(f, "route {r} is already registered"),
            BridgeError::UnknownRoute(r) => write!(f, "route {r} is not registered"),
            BridgeError::NotPending(id) => write!(f, "transfer {id} is not pending"),
            BridgeError::UnknownTransfer(id) => write!(f, "unknown transfer: {id}"),
        }
    }
}

impl std::error::Error for BridgeError {}

pub struct BridgeService {
    /// "FROM->TO:TOKEN" -> config.
    bridges: RwLock<HashMap<String, BridgeConfig>>,
    transfers: RwLock<HashMap<String, BridgeTransfer>>,
    next_id: RwLock<u64>,
}

impl BridgeService {
    pub fn new() -> Self {
        Self {
            bridges: RwLock::new(HashMap::new()),
            transfers: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    fn route_key(from: &str, to: &str, token: &str) -> String {
        format!("{from}->{to}:{token}")
    }

    /// Register a bridge route with its fee and minimum.
    pub fn register_bridge(
        &self,
        from: &str,
        to: &str,
        token: &str,
        fee: f64,
        min_amount: f64,
    ) -> Result<(), BridgeError> {
        if from.trim().is_empty() || to.trim().is_empty() {
            return Err(BridgeError::EmptyChain);
        }
        if token.trim().is_empty() {
            return Err(BridgeError::EmptyToken);
        }
        if !fee.is_finite() || fee < 0.0 || fee >= 1.0 {
            return Err(BridgeError::InvalidFee(fee));
        }
        if !min_amount.is_finite() || min_amount <= 0.0 {
            return Err(BridgeError::InvalidMinAmount(min_amount));
        }

        let key = Self::route_key(from, to, token);
        let mut bridges = self.bridges.write().unwrap();
        if bridges.contains_key(&key) {
            return Err(BridgeError::DuplicateRoute(key));
        }
        bridges.insert(
            key,
            BridgeConfig {
                from_chain: from.to_string(),
                to_chain: to.to_string(),
                token: token.to_string(),
                fee,
                min_amount,
            },
        );
        Ok(())
    }

    /// Initiate a bridge transfer. The fee is deducted from the amount to give
    /// the amount received on the destination chain.
    pub fn bridge(
        &self,
        user_id: &str,
        from: &str,
        to: &str,
        token: &str,
        amount: f64,
    ) -> Result<BridgeTransfer, BridgeError> {
        if !amount.is_finite() || amount <= 0.0 {
            return Err(BridgeError::InvalidAmount(amount));
        }

        let key = Self::route_key(from, to, token);
        let config = self
            .bridges
            .read()
            .unwrap()
            .get(&key)
            .cloned()
            .ok_or_else(|| BridgeError::UnknownRoute(key))?;

        if amount < config.min_amount {
            return Err(BridgeError::BelowMinimum {
                min: config.min_amount,
            });
        }

        let fee = amount * config.fee;
        let mut next_id = self.next_id.write().unwrap();
        let id = format!("br_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        let transfer = BridgeTransfer {
            id: id.clone(),
            user_id: user_id.to_string(),
            token: token.to_string(),
            amount,
            fee,
            received: amount - fee,
            status: BridgeStatus::Pending,
        };
        self.transfers
            .write()
            .unwrap()
            .insert(id, transfer.clone());
        Ok(transfer)
    }

    fn set_status(&self, id: &str, status: BridgeStatus) -> Result<BridgeTransfer, BridgeError> {
        let mut transfers = self.transfers.write().unwrap();
        let transfer = transfers
            .get_mut(id)
            .ok_or_else(|| BridgeError::UnknownTransfer(id.to_string()))?;
        if transfer.status != BridgeStatus::Pending {
            return Err(BridgeError::NotPending(id.to_string()));
        }
        transfer.status = status;
        Ok(transfer.clone())
    }

    pub fn complete(&self, id: &str) -> Result<BridgeTransfer, BridgeError> {
        self.set_status(id, BridgeStatus::Completed)
    }

    pub fn fail(&self, id: &str) -> Result<BridgeTransfer, BridgeError> {
        self.set_status(id, BridgeStatus::Failed)
    }

    pub fn transfer(&self, id: &str) -> Option<BridgeTransfer> {
        self.transfers.read().unwrap().get(id).cloned()
    }

    pub fn pending_count(&self) -> usize {
        self.transfers
            .read()
            .unwrap()
            .values()
            .filter(|t| t.status == BridgeStatus::Pending)
            .count()
    }
}

impl Default for BridgeService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc() -> BridgeService {
        let s = BridgeService::new();
        s.register_bridge("Ethereum", "TigerEx", "USDT", 0.001, 10.0)
            .unwrap();
        s
    }

    #[test]
    fn the_fee_is_deducted_from_the_amount() {
        let svc = svc();
        let t = svc.bridge("alice", "Ethereum", "TigerEx", "USDT", 1_000.0).unwrap();

        assert_eq!(t.fee, 1.0);
        assert_eq!(t.received, 999.0);
        assert_eq!(t.status, BridgeStatus::Pending);
    }

    #[test]
    fn same_amount_transfers_do_not_collide() {
        let svc = svc();
        let a = svc.bridge("alice", "Ethereum", "TigerEx", "USDT", 100.0).unwrap();
        let b = svc.bridge("bob", "Ethereum", "TigerEx", "USDT", 100.0).unwrap();

        // The old id was "br_100" for both.
        assert_ne!(a.id, b.id);
        assert!(svc.transfer(&a.id).is_some());
        assert!(svc.transfer(&b.id).is_some());
    }

    #[test]
    fn invalid_amounts_and_below_minimum_are_rejected() {
        let svc = svc();
        assert!(svc.bridge("alice", "Ethereum", "TigerEx", "USDT", -1.0).is_err());
        assert!(svc.bridge("alice", "Ethereum", "TigerEx", "USDT", f64::NAN).is_err());
        assert!(matches!(
            svc.bridge("alice", "Ethereum", "TigerEx", "USDT", 5.0).unwrap_err(),
            BridgeError::BelowMinimum { .. }
        ));
    }

    #[test]
    fn unknown_routes_and_duplicate_registration_are_rejected() {
        let svc = svc();
        assert!(matches!(
            svc.bridge("alice", "Ethereum", "Solana", "USDT", 100.0).unwrap_err(),
            BridgeError::UnknownRoute(_)
        ));
        assert!(matches!(
            svc.register_bridge("Ethereum", "TigerEx", "USDT", 0.001, 10.0).unwrap_err(),
            BridgeError::DuplicateRoute(_)
        ));
    }

    #[test]
    fn invalid_configuration_is_rejected() {
        let svc = BridgeService::new();
        assert!(svc.register_bridge("", "TigerEx", "USDT", 0.001, 10.0).is_err());
        assert!(svc.register_bridge("Ethereum", "TigerEx", "", 0.001, 10.0).is_err());
        assert!(svc.register_bridge("Ethereum", "TigerEx", "USDT", 1.5, 10.0).is_err());
        assert!(svc.register_bridge("Ethereum", "TigerEx", "USDT", 0.001, 0.0).is_err());
    }

    #[test]
    fn completion_happens_once() {
        let svc = svc();
        let t = svc.bridge("alice", "Ethereum", "TigerEx", "USDT", 100.0).unwrap();

        assert_eq!(svc.complete(&t.id).unwrap().status, BridgeStatus::Completed);
        assert!(matches!(
            svc.complete(&t.id).unwrap_err(),
            BridgeError::NotPending(_)
        ));
    }
}
