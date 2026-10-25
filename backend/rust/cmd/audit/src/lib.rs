//! Tamper-evident audit log.
//!
//! The previous implementation stored plain `(user_id, action)` pairs, derived
//! ids from the entry count so they were reused after any removal, and
//! recorded no timestamp or previous-entry link, so nothing could be verified.
//!
//! This log chains every entry to the one before it with a SHA-256 hash. Any
//! edit, removal or reordering of an entry breaks the chain, and
//! [`AuditService::verify`] reports the first index at which it breaks.

use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

/// An immutable audit entry.
#[derive(Debug, Clone, PartialEq)]
pub struct AuditEntry {
    /// Monotonic sequence number, starting at 1.
    pub seq: u64,
    pub user_id: String,
    pub action: String,
    /// Caller-supplied timestamp in milliseconds since the Unix epoch.
    pub timestamp_ms: u64,
    /// Hash of the previous entry; all zeros for the first.
    pub prev_hash: String,
    /// Hash over this entry's fields plus `prev_hash`.
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AuditError {
    EmptyUser,
    EmptyAction,
    BrokenChain { index: usize },
}

impl std::fmt::Display for AuditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuditError::EmptyUser => write!(f, "user id must not be empty"),
            AuditError::EmptyAction => write!(f, "action must not be empty"),
            AuditError::BrokenChain { index } => write!(f, "audit chain is broken at index {index}"),
        }
    }
}

impl std::error::Error for AuditError {}

const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

fn entry_hash(seq: u64, user_id: &str, action: &str, timestamp_ms: u64, prev_hash: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(seq.to_be_bytes());
    // Length-prefix the variable fields so no two distinct inputs can
    // concatenate to the same byte stream.
    hasher.update((user_id.len() as u64).to_be_bytes());
    hasher.update(user_id.as_bytes());
    hasher.update((action.len() as u64).to_be_bytes());
    hasher.update(action.as_bytes());
    hasher.update(timestamp_ms.to_be_bytes());
    hasher.update(prev_hash.as_bytes());
    hex::encode(hasher.finalize())
}

pub struct AuditService {
    entries: RwLock<VecDeque<AuditEntry>>,
    next_seq: AtomicU64,
}

impl AuditService {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(VecDeque::new()),
            next_seq: AtomicU64::new(1),
        }
    }

    /// Append an entry, chaining it to the previous one.
    ///
    /// The caller supplies the timestamp, so the log does not depend on a
    /// wall clock of its own.
    pub fn log(
        &self,
        user_id: &str,
        action: &str,
        timestamp_ms: u64,
    ) -> Result<AuditEntry, AuditError> {
        if user_id.trim().is_empty() {
            return Err(AuditError::EmptyUser);
        }
        if action.trim().is_empty() {
            return Err(AuditError::EmptyAction);
        }

        let mut entries = self.entries.write().unwrap();
        let prev_hash = entries
            .back()
            .map(|e| e.hash.clone())
            .unwrap_or_else(|| GENESIS_HASH.to_string());

        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let hash = entry_hash(seq, user_id, action, timestamp_ms, &prev_hash);
        let entry = AuditEntry {
            seq,
            user_id: user_id.to_string(),
            action: action.to_string(),
            timestamp_ms,
            prev_hash,
            hash,
        };
        entries.push_back(entry.clone());
        Ok(entry)
    }

    /// Every action recorded for a user, in order.
    pub fn query(&self, user_id: &str) -> Vec<AuditEntry> {
        self.entries
            .read()
            .unwrap()
            .iter()
            .filter(|e| e.user_id == user_id)
            .cloned()
            .collect()
    }

    pub fn len(&self) -> usize {
        self.entries.read().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Walk the chain and confirm every entry's hash and link.
    pub fn verify(&self) -> Result<(), AuditError> {
        let entries = self.entries.read().unwrap();
        let mut prev = GENESIS_HASH.to_string();

        for (index, entry) in entries.iter().enumerate() {
            if entry.prev_hash != prev {
                return Err(AuditError::BrokenChain { index });
            }
            let expected = entry_hash(
                entry.seq,
                &entry.user_id,
                &entry.action,
                entry.timestamp_ms,
                &entry.prev_hash,
            );
            if expected != entry.hash {
                return Err(AuditError::BrokenChain { index });
            }
            prev = entry.hash.clone();
        }
        Ok(())
    }
}

impl Default for AuditService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_chain_and_verify() {
        let svc = AuditService::new();
        let first = svc.log("admin", "list_market", 1_700_000_000_000).unwrap();
        let second = svc.log("admin", "set_fee", 1_700_000_000_100).unwrap();

        assert_eq!(first.seq, 1);
        assert_eq!(first.prev_hash, GENESIS_HASH);
        assert_eq!(second.prev_hash, first.hash);
        assert_ne!(first.hash, second.hash);
        svc.verify().unwrap();
    }

    #[test]
    fn sequence_numbers_are_unique_and_monotonic() {
        let svc = AuditService::new();
        let a = svc.log("admin", "a", 1).unwrap();
        let b = svc.log("admin", "b", 2).unwrap();
        assert!(b.seq > a.seq);
    }

    #[test]
    fn editing_an_entry_breaks_the_chain() {
        let svc = AuditService::new();
        svc.log("admin", "pause_market", 1_700_000_000_000).unwrap();
        svc.log("admin", "unpause_market", 1_700_000_000_100).unwrap();

        // Tamper with the first entry's action.
        svc.entries.write().unwrap()[0].action = "no_op".to_string();

        assert!(matches!(
            svc.verify().unwrap_err(),
            AuditError::BrokenChain { index: 0 }
        ));
    }

    #[test]
    fn removing_an_entry_breaks_the_chain() {
        let svc = AuditService::new();
        svc.log("admin", "a", 1).unwrap();
        svc.log("admin", "b", 2).unwrap();
        svc.log("admin", "c", 3).unwrap();

        svc.entries.write().unwrap().remove(1);

        assert!(matches!(
            svc.verify().unwrap_err(),
            AuditError::BrokenChain { index: 1 }
        ));
    }

    #[test]
    fn query_filters_by_user_and_preserves_order() {
        let svc = AuditService::new();
        svc.log("admin", "a", 1).unwrap();
        svc.log("trader", "b", 2).unwrap();
        svc.log("admin", "c", 3).unwrap();

        let admin = svc.query("admin");
        assert_eq!(admin.len(), 2);
        assert_eq!(admin[0].action, "a");
        assert_eq!(admin[1].action, "c");
    }

    #[test]
    fn empty_fields_are_rejected() {
        let svc = AuditService::new();
        assert!(svc.log("", "action", 1).is_err());
        assert!(svc.log("admin", "", 1).is_err());
        assert_eq!(svc.len(), 0);
    }

    #[test]
    fn a_single_bit_change_is_detected() {
        let svc = AuditService::new();
        svc.log("admin", "a", 1).unwrap();

        let mut hash = svc.entries.read().unwrap()[0].hash.clone();
        hash.replace_range(0..1, "f");
        svc.entries.write().unwrap()[0].hash = hash;

        assert!(svc.verify().is_err());
    }
}
