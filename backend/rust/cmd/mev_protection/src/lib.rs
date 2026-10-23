//! MEV protection for TigerEx.
//!
//! Tracks which transactions are protected and which bundles have been
//! submitted. Transaction hashes are validated as 32-byte hex so malformed
//! input is rejected rather than stored.

use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct ProtectedTx {
    pub tx_hash: String,
    pub user_id: String,
    pub bundle_id: Option<String>,
    pub protected_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MevError {
    EmptyUserId,
    InvalidTxHash(String),
    EmptyBundle,
    UnknownBundle(String),
}

impl std::fmt::Display for MevError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MevError::EmptyUserId => write!(f, "user_id must not be empty"),
            MevError::InvalidTxHash(hash) => {
                write!(f, "transaction hash must be 64 hex characters, got {hash:?}")
            }
            MevError::EmptyBundle => write!(f, "a bundle needs at least one transaction"),
            MevError::UnknownBundle(id) => write!(f, "unknown bundle: {id}"),
        }
    }
}

impl std::error::Error for MevError {}

/// A transaction hash is 32 bytes, hex encoded.
fn is_valid_tx_hash(hash: &str) -> bool {
    let trimmed = hash.strip_prefix("0x").unwrap_or(hash);
    trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit())
}

pub struct MEVProtectionService {
    protected: RwLock<HashSet<String>>,
    bundles: RwLock<HashMap<String, Vec<String>>>,
    records: RwLock<HashMap<String, ProtectedTx>>,
}

impl Default for MEVProtectionService {
    fn default() -> Self {
        Self::new()
    }
}

impl MEVProtectionService {
    pub fn new() -> Self {
        Self {
            protected: RwLock::new(HashSet::new()),
            bundles: RwLock::new(HashMap::new()),
            records: RwLock::new(HashMap::new()),
        }
    }

    pub fn protect(&self, tx_hash: &str, user_id: &str, now_ms: u64) -> Result<ProtectedTx, MevError> {
        if user_id.trim().is_empty() {
            return Err(MevError::EmptyUserId);
        }
        if !is_valid_tx_hash(tx_hash) {
            return Err(MevError::InvalidTxHash(tx_hash.to_string()));
        }

        let record = ProtectedTx {
            tx_hash: tx_hash.to_string(),
            user_id: user_id.to_string(),
            bundle_id: None,
            protected_at_ms: now_ms,
        };

        self.protected.write().unwrap().insert(tx_hash.to_string());
        self.records
            .write()
            .unwrap()
            .insert(tx_hash.to_string(), record.clone());
        Ok(record)
    }

    /// Group protected transactions into a bundle. Every hash must already be
    /// protected, so a bundle cannot reference untracked transactions.
    pub fn bundle(&self, tx_hashes: Vec<String>) -> Result<String, MevError> {
        if tx_hashes.is_empty() {
            return Err(MevError::EmptyBundle);
        }
        {
            let protected = self.protected.read().unwrap();
            for hash in &tx_hashes {
                if !protected.contains(hash) {
                    return Err(MevError::InvalidTxHash(hash.clone()));
                }
            }
        }

        let mut bundles = self.bundles.write().unwrap();
        let id = format!("bundle_{}", bundles.len());
        bundles.insert(id.clone(), tx_hashes.clone());

        let mut records = self.records.write().unwrap();
        for hash in &tx_hashes {
            if let Some(record) = records.get_mut(hash) {
                record.bundle_id = Some(id.clone());
            }
        }

        Ok(id)
    }

    pub fn is_protected(&self, tx_hash: &str) -> bool {
        self.protected.read().unwrap().contains(tx_hash)
    }

    pub fn bundle_members(&self, bundle_id: &str) -> Result<Vec<String>, MevError> {
        self.bundles
            .read()
            .unwrap()
            .get(bundle_id)
            .cloned()
            .ok_or_else(|| MevError::UnknownBundle(bundle_id.to_string()))
    }

    pub fn record(&self, tx_hash: &str) -> Option<ProtectedTx> {
        self.records.read().unwrap().get(tx_hash).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(byte: u8) -> String {
        format!("{:02x}", byte).repeat(32)
    }

    #[test]
    fn rejects_invalid_hashes_and_users() {
        let service = MEVProtectionService::new();
        assert_eq!(
            service.protect(&hash(0x01), "", 0).unwrap_err(),
            MevError::EmptyUserId
        );
        assert!(matches!(
            service.protect("not-a-hash", "u1", 0).unwrap_err(),
            MevError::InvalidTxHash(_)
        ));
        assert!(matches!(
            service.protect("0x1234", "u1", 0).unwrap_err(),
            MevError::InvalidTxHash(_)
        ));
    }

    #[test]
    fn protects_and_records() {
        let service = MEVProtectionService::new();
        let tx = hash(0xab);
        let record = service.protect(&tx, "u1", 1234).unwrap();
        assert_eq!(record.protected_at_ms, 1234);
        assert!(service.is_protected(&tx));
        assert_eq!(service.record(&tx).unwrap().user_id, "u1");
    }

    #[test]
    fn bundles_only_protected_transactions() {
        let service = MEVProtectionService::new();
        let tx1 = hash(0x01);
        let tx2 = hash(0x02);
        let unprotected = hash(0x03);

        service.protect(&tx1, "u1", 0).unwrap();
        service.protect(&tx2, "u1", 0).unwrap();

        assert!(matches!(
            service.bundle(vec![tx1.clone(), unprotected]).unwrap_err(),
            MevError::InvalidTxHash(_)
        ));
        assert_eq!(service.bundle(vec![]).unwrap_err(), MevError::EmptyBundle);

        let id = service.bundle(vec![tx1.clone(), tx2.clone()]).unwrap();
        assert_eq!(service.bundle_members(&id).unwrap().len(), 2);
        assert_eq!(service.record(&tx1).unwrap().bundle_id, Some(id));
    }
}
