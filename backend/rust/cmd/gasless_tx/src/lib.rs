//! Gasless (sponsored) transactions.
//!
//! The previous implementation derived the transaction id from the length of
//! the calldata, so every transaction of the same size collided and overwrote
//! the previous one, and it accepted empty users and calldata.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct GaslessTx {
    pub tx_hash: String,
    pub user_id: String,
    pub fee_payer: String,
    pub gas_sponsored: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GaslessError {
    EmptyUser,
    EmptyCalldata,
    UnknownTx(String),
    AlreadyRevoked(String),
}

impl std::fmt::Display for GaslessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GaslessError::EmptyUser => write!(f, "user id must not be empty"),
            GaslessError::EmptyCalldata => write!(f, "calldata must not be empty"),
            GaslessError::UnknownTx(h) => write!(f, "unknown transaction: {h}"),
            GaslessError::AlreadyRevoked(h) => write!(f, "transaction {h} was already revoked"),
        }
    }
}

impl std::error::Error for GaslessError {}

pub struct GaslessTxService {
    transactions: RwLock<HashMap<String, GaslessTx>>,
    next_id: RwLock<u64>,
}

impl GaslessTxService {
    pub fn new() -> Self {
        Self {
            transactions: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Sponsor a transaction, making the platform the fee payer.
    pub fn sponsor(&self, user_id: &str, tx_data: &str) -> Result<String, GaslessError> {
        if user_id.trim().is_empty() {
            return Err(GaslessError::EmptyUser);
        }
        if tx_data.trim().is_empty() {
            return Err(GaslessError::EmptyCalldata);
        }

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("gl_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.transactions.write().unwrap().insert(
            id.clone(),
            GaslessTx {
                tx_hash: id.clone(),
                user_id: user_id.to_string(),
                fee_payer: "platform".to_string(),
                gas_sponsored: true,
            },
        );
        Ok(id)
    }

    pub fn is_sponsored(&self, tx_hash: &str) -> bool {
        self.transactions
            .read()
            .unwrap()
            .get(tx_hash)
            .map(|t| t.gas_sponsored)
            .unwrap_or(false)
    }

    /// Revoke sponsorship, so the user becomes the fee payer.
    pub fn revoke(&self, tx_hash: &str) -> Result<GaslessTx, GaslessError> {
        let mut transactions = self.transactions.write().unwrap();
        let tx = transactions
            .get_mut(tx_hash)
            .ok_or_else(|| GaslessError::UnknownTx(tx_hash.to_string()))?;
        if !tx.gas_sponsored {
            return Err(GaslessError::AlreadyRevoked(tx_hash.to_string()));
        }
        tx.gas_sponsored = false;
        tx.fee_payer = tx.user_id.clone();
        Ok(tx.clone())
    }

    pub fn get(&self, tx_hash: &str) -> Option<GaslessTx> {
        self.transactions.read().unwrap().get(tx_hash).cloned()
    }

    pub fn count(&self) -> usize {
        self.transactions.read().unwrap().len()
    }
}

impl Default for GaslessTxService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_length_calldata_does_not_collide() {
        let svc = GaslessTxService::new();
        let a = svc.sponsor("u1", "0xaaaa").unwrap();
        let b = svc.sponsor("u1", "0xbbbb").unwrap();

        // The old id was the calldata length, so b overwrote a.
        assert_ne!(a, b);
        assert_eq!(svc.count(), 2);
        assert!(svc.is_sponsored(&a));
        assert!(svc.is_sponsored(&b));
    }

    #[test]
    fn empty_inputs_are_rejected() {
        let svc = GaslessTxService::new();
        assert!(svc.sponsor("", "0xaa").is_err());
        assert!(svc.sponsor("u1", "").is_err());
        assert_eq!(svc.count(), 0);
    }

    #[test]
    fn revoking_transfers_the_fee_to_the_user() {
        let svc = GaslessTxService::new();
        let id = svc.sponsor("u1", "0xaa").unwrap();

        let tx = svc.revoke(&id).unwrap();
        assert!(!tx.gas_sponsored);
        assert_eq!(tx.fee_payer, "u1");
        assert!(!svc.is_sponsored(&id));

        // Revoking twice fails.
        assert!(matches!(
            svc.revoke(&id).unwrap_err(),
            GaslessError::AlreadyRevoked(_)
        ));
    }

    #[test]
    fn unknown_transactions_are_rejected() {
        let svc = GaslessTxService::new();
        assert!(!svc.is_sponsored("nope"));
        assert!(svc.revoke("nope").is_err());
    }
}
