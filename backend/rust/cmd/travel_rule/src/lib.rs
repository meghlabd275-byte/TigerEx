//! Travel Rule (FATF Recommendation 16) for TigerEx.
//!
//! Records the originator and beneficiary data that must accompany a virtual
//! asset transfer. Records move from pending to verified exactly once, and
//! inputs are validated so malformed transfers are rejected.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct TravelRuleData {
    pub tx_id: String,
    pub sender: String,
    pub recipient: String,
    pub amount: f64,
    pub verified: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TravelRuleError {
    EmptyField(&'static str),
    InvalidAmount(f64),
    DuplicateTransaction(String),
    UnknownTransaction(String),
    AlreadyVerified(String),
}

impl std::fmt::Display for TravelRuleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TravelRuleError::EmptyField(field) => write!(f, "{field} must not be empty"),
            TravelRuleError::InvalidAmount(amount) => {
                write!(f, "amount {amount} must be positive and finite")
            }
            TravelRuleError::DuplicateTransaction(id) => {
                write!(f, "transaction {id} has already been submitted")
            }
            TravelRuleError::UnknownTransaction(id) => write!(f, "unknown transaction: {id}"),
            TravelRuleError::AlreadyVerified(id) => {
                write!(f, "transaction {id} is already verified")
            }
        }
    }
}

impl std::error::Error for TravelRuleError {}

pub struct TravelRuleService {
    pending: RwLock<HashMap<String, TravelRuleData>>,
    verified: RwLock<HashMap<String, TravelRuleData>>,
}

impl Default for TravelRuleService {
    fn default() -> Self {
        Self::new()
    }
}

impl TravelRuleService {
    pub fn new() -> Self {
        Self {
            pending: RwLock::new(HashMap::new()),
            verified: RwLock::new(HashMap::new()),
        }
    }

    pub fn submit(
        &self,
        tx_id: &str,
        sender: &str,
        recipient: &str,
        amount: f64,
    ) -> Result<String, TravelRuleError> {
        if tx_id.trim().is_empty() {
            return Err(TravelRuleError::EmptyField("tx_id"));
        }
        if sender.trim().is_empty() {
            return Err(TravelRuleError::EmptyField("sender"));
        }
        if recipient.trim().is_empty() {
            return Err(TravelRuleError::EmptyField("recipient"));
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(TravelRuleError::InvalidAmount(amount));
        }

        {
            let pending = self.pending.read().unwrap();
            let verified = self.verified.read().unwrap();
            if pending.contains_key(tx_id) || verified.contains_key(tx_id) {
                return Err(TravelRuleError::DuplicateTransaction(tx_id.to_string()));
            }
        }

        let record = TravelRuleData {
            tx_id: tx_id.to_string(),
            sender: sender.to_string(),
            recipient: recipient.to_string(),
            amount,
            verified: false,
        };
        self.pending.write().unwrap().insert(tx_id.to_string(), record);
        Ok(tx_id.to_string())
    }

    pub fn verify(&self, tx_id: &str) -> Result<(), TravelRuleError> {
        let record = {
            let mut pending = self.pending.write().unwrap();
            pending
                .remove(tx_id)
                .ok_or_else(|| TravelRuleError::UnknownTransaction(tx_id.to_string()))?
        };

        let mut verified = record;
        verified.verified = true;
        self.verified.write().unwrap().insert(tx_id.to_string(), verified);
        Ok(())
    }

    pub fn is_verified(&self, tx_id: &str) -> bool {
        self.verified.read().unwrap().contains_key(tx_id)
    }

    pub fn pending_count(&self) -> usize {
        self.pending.read().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_submissions() {
        let service = TravelRuleService::new();
        assert_eq!(
            service.submit("", "alice", "bob", 10.0).unwrap_err(),
            TravelRuleError::EmptyField("tx_id")
        );
        assert_eq!(
            service.submit("tx1", "alice", "bob", 0.0).unwrap_err(),
            TravelRuleError::InvalidAmount(0.0)
        );
    }

    #[test]
    fn rejects_duplicates() {
        let service = TravelRuleService::new();
        service.submit("tx1", "alice", "bob", 10.0).unwrap();
        assert_eq!(
            service.submit("tx1", "alice", "bob", 10.0).unwrap_err(),
            TravelRuleError::DuplicateTransaction("tx1".to_string())
        );
    }

    #[test]
    fn verify_moves_record_once() {
        let service = TravelRuleService::new();
        service.submit("tx1", "alice", "bob", 10.0).unwrap();
        assert_eq!(service.pending_count(), 1);

        service.verify("tx1").unwrap();
        assert!(service.is_verified("tx1"));
        assert_eq!(service.pending_count(), 0);

        assert_eq!(
            service.verify("tx1").unwrap_err(),
            TravelRuleError::UnknownTransaction("tx1".to_string())
        );
    }
}
