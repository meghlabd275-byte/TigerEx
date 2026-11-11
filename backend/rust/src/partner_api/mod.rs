//! Partner API - Rust Implementation
//!
//! Issues partner API keys. A key is generated from a CSPRNG, returned to the
//! caller exactly once, and stored only as a SHA-256 hash, so a leak of this
//! table does not reveal any usable key. Verification is a constant-time
//! comparison and fails closed for a disabled partner.

use serde::{Serialize, Deserialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartnerApp {
    pub id: String,
    pub name: String,
    /// SHA-256 hash of the issued key. The plaintext key is never retained.
    pub api_key_hash: String,
    pub rate_limit: u32,
    pub enabled: bool,
}

pub struct PartnerAPIService {
    partners: HashMap<String, PartnerApp>,
    counter: u64,
}

impl PartnerAPIService {
    pub fn new() -> Self {
        Self { partners: HashMap::new(), counter: 0 }
    }

    fn hash_key(key: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(key.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Register a partner and return `(id, plaintext_key)`. The plaintext key
    /// is shown to the caller once and only its hash is stored.
    pub fn register(&mut self, name: &str) -> Result<(String, String), String> {
        if name.trim().is_empty() {
            return Err("partner name is required".to_string());
        }

        self.counter += 1;
        let id = format!("PARTNER_{}", self.counter);

        let mut key_bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key_bytes);
        let key = format!("pk_{}", hex::encode(key_bytes));

        self.partners.insert(
            id.clone(),
            PartnerApp {
                id: id.clone(),
                name: name.to_string(),
                api_key_hash: Self::hash_key(&key),
                rate_limit: 1000,
                enabled: true,
            },
        );

        Ok((id, key))
    }

    /// Verify a presented key in constant time against every active partner.
    pub fn verify(&self, key: &str) -> bool {
        if key.is_empty() {
            return false;
        }
        let presented = Self::hash_key(key);
        self.partners
            .values()
            .any(|p| p.enabled && constant_time_eq(p.api_key_hash.as_bytes(), presented.as_bytes()))
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> bool {
        match self.partners.get_mut(id) {
            Some(p) => {
                p.enabled = enabled;
                true
            }
            None => false,
        }
    }
}

impl Default for PartnerAPIService {
    fn default() -> Self {
        Self::new()
    }
}

/// Compare two byte strings without an early exit.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

use rand::RngCore;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issued_key_verifies_and_plaintext_is_not_stored() {
        let mut p = PartnerAPIService::new();
        let (id, key) = p.register("Acme Corp").unwrap();
        assert!(!id.is_empty());
        assert!(p.verify(&key));
        let app = p.partners.get(&id).unwrap();
        assert_ne!(app.api_key_hash, key);
        assert_eq!(app.api_key_hash, PartnerAPIService::hash_key(&key));
    }

    #[test]
    fn keys_are_unique_and_not_guessable() {
        let mut p = PartnerAPIService::new();
        let (_, k1) = p.register("a").unwrap();
        let (_, k2) = p.register("b").unwrap();
        assert_ne!(k1, k2);
        assert!(k1.len() > 20);
    }

    #[test]
    fn unknown_and_empty_keys_fail_closed() {
        let mut p = PartnerAPIService::new();
        let (_, key) = p.register("a").unwrap();
        assert!(!p.verify(""));
        assert!(!p.verify("pk_deadbeef"));
        assert!(p.verify(&key));
    }

    #[test]
    fn disabled_partner_key_is_rejected() {
        let mut p = PartnerAPIService::new();
        let (id, key) = p.register("a").unwrap();
        assert!(p.verify(&key));
        assert!(p.set_enabled(&id, false));
        assert!(!p.verify(&key));
    }

    #[test]
    fn empty_name_is_rejected() {
        let mut p = PartnerAPIService::new();
        assert!(p.register("  ").is_err());
    }
}
