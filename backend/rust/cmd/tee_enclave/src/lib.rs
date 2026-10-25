//! Sealed storage for sensitive material.
//!
//! The previous implementation did not encrypt anything: `encrypt` returned
//! `"enc_<length>"` and `decrypt` returned its input unchanged, so callers
//! believed data was sealed when it was in the clear. It also handed out
//! enclave ids that were never registered, so any caller could "decrypt" with
//! any id.
//!
//! This module performs real authenticated encryption (AES-256-GCM) with a
//! per-enclave key. It is an in-process sealed-store abstraction; it does not
//! claim hardware attestation.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::rngs::OsRng;
use rand::RngCore;
use std::collections::HashMap;
use std::sync::RwLock;

const NONCE_LEN: usize = 12;

#[derive(Debug, Clone, PartialEq)]
pub enum EnclaveError {
    EmptyUser,
    UnknownEnclave(String),
    EmptyCiphertext,
    TooShort(usize),
    DecryptFailed,
    RandomFailure,
}

impl std::fmt::Display for EnclaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnclaveError::EmptyUser => write!(f, "user id must not be empty"),
            EnclaveError::UnknownEnclave(id) => write!(f, "unknown enclave: {id}"),
            EnclaveError::EmptyCiphertext => write!(f, "ciphertext must not be empty"),
            EnclaveError::TooShort(n) => write!(f, "ciphertext of {n} bytes is too short"),
            EnclaveError::DecryptFailed => write!(f, "authentication failed while decrypting"),
            EnclaveError::RandomFailure => write!(f, "failed to obtain random bytes"),
        }
    }
}

impl std::error::Error for EnclaveError {}

/// An enclave holding a key that never leaves the store.
struct Enclave {
    id: String,
    user_id: String,
    key: [u8; 32],
}

pub struct TEEEnclaveService {
    enclaves: RwLock<HashMap<String, Enclave>>,
    next_id: RwLock<u64>,
}

impl TEEEnclaveService {
    pub fn new() -> Self {
        Self {
            enclaves: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Create an enclave with a fresh 256-bit key.
    pub fn create_enclave(&self, user_id: &str) -> Result<String, EnclaveError> {
        if user_id.trim().is_empty() {
            return Err(EnclaveError::EmptyUser);
        }

        let mut key = [0u8; 32];
        OsRng
            .try_fill_bytes(&mut key)
            .map_err(|_| EnclaveError::RandomFailure)?;

        let mut next_id = self.next_id.write().unwrap();
        let id = format!("enclave_{}", *next_id);
        *next_id += 1;
        drop(next_id);

        self.enclaves.write().unwrap().insert(
            id.clone(),
            Enclave {
                id: id.clone(),
                user_id: user_id.to_string(),
                key,
            },
        );
        Ok(id)
    }

    /// Encrypt `data` with the enclave's key.
    ///
    /// The output is `nonce || ciphertext || tag`.
    pub fn encrypt(&self, enclave_id: &str, data: &[u8]) -> Result<Vec<u8>, EnclaveError> {
        let key = {
            let enclaves = self.enclaves.read().unwrap();
            enclaves
                .get(enclave_id)
                .ok_or_else(|| EnclaveError::UnknownEnclave(enclave_id.to_string()))?
                .key
        };

        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| EnclaveError::DecryptFailed)?;

        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng
            .try_fill_bytes(&mut nonce_bytes)
            .map_err(|_| EnclaveError::RandomFailure)?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, data)
            .map_err(|_| EnclaveError::DecryptFailed)?;

        let mut out = nonce_bytes.to_vec();
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Decrypt data produced by `encrypt` for the same enclave.
    ///
    /// A wrong enclave, or any tampering, fails authentication.
    pub fn decrypt(&self, enclave_id: &str, data: &[u8]) -> Result<Vec<u8>, EnclaveError> {
        if data.is_empty() {
            return Err(EnclaveError::EmptyCiphertext);
        }
        if data.len() <= NONCE_LEN {
            return Err(EnclaveError::TooShort(data.len()));
        }

        let key = {
            let enclaves = self.enclaves.read().unwrap();
            enclaves
                .get(enclave_id)
                .ok_or_else(|| EnclaveError::UnknownEnclave(enclave_id.to_string()))?
                .key
        };

        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| EnclaveError::DecryptFailed)?;
        let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| EnclaveError::DecryptFailed)
    }

    pub fn owner(&self, enclave_id: &str) -> Option<String> {
        self.enclaves
            .read()
            .unwrap()
            .get(enclave_id)
            .map(|e| e.user_id.clone())
    }

    pub fn exists(&self, enclave_id: &str) -> bool {
        self.enclaves.read().unwrap().contains_key(enclave_id)
    }
}

impl Default for TEEEnclaveService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encryption_actually_changes_the_data() {
        let svc = TEEEnclaveService::new();
        let id = svc.create_enclave("alice").unwrap();

        let plaintext = b"private key material";
        let ciphertext = svc.encrypt(&id, plaintext).unwrap();

        // The old implementation returned "enc_<len>" and decrypt echoed input.
        assert_ne!(ciphertext, plaintext);
        assert!(!ciphertext.windows(plaintext.len()).any(|w| w == plaintext));
        assert!(ciphertext.len() > plaintext.len());
    }

    #[test]
    fn decryption_round_trips() {
        let svc = TEEEnclaveService::new();
        let id = svc.create_enclave("alice").unwrap();

        let plaintext = b"seed phrase";
        let ciphertext = svc.encrypt(&id, plaintext).unwrap();
        assert_eq!(svc.decrypt(&id, &ciphertext).unwrap(), plaintext);
    }

    #[test]
    fn a_different_enclave_cannot_decrypt() {
        let svc = TEEEnclaveService::new();
        let alice = svc.create_enclave("alice").unwrap();
        let bob = svc.create_enclave("bob").unwrap();

        let ciphertext = svc.encrypt(&alice, b"secret").unwrap();
        assert!(matches!(
            svc.decrypt(&bob, &ciphertext).unwrap_err(),
            EnclaveError::DecryptFailed
        ));
    }

    #[test]
    fn tampering_is_detected() {
        let svc = TEEEnclaveService::new();
        let id = svc.create_enclave("alice").unwrap();

        let mut ciphertext = svc.encrypt(&id, b"secret").unwrap();
        let last = ciphertext.len() - 1;
        ciphertext[last] ^= 0x01;

        assert!(matches!(
            svc.decrypt(&id, &ciphertext).unwrap_err(),
            EnclaveError::DecryptFailed
        ));
    }

    #[test]
    fn unknown_and_empty_inputs_are_rejected() {
        let svc = TEEEnclaveService::new();
        assert!(svc.create_enclave("").is_err());
        assert!(svc.encrypt("enclave_missing", b"x").is_err());
        assert!(svc.decrypt("enclave_missing", b"xxxxxxxxxxxxx").is_err());

        let id = svc.create_enclave("alice").unwrap();
        assert!(svc.decrypt(&id, b"").is_err());
        assert!(svc.decrypt(&id, b"short").is_err());
    }

    #[test]
    fn enclave_ids_are_unique_and_registered() {
        let svc = TEEEnclaveService::new();
        let a = svc.create_enclave("alice").unwrap();
        let b = svc.create_enclave("alice").unwrap();

        assert_ne!(a, b);
        assert!(svc.exists(&a));
        assert!(svc.exists(&b));
        assert_eq!(svc.owner(&a).as_deref(), Some("alice"));
    }
}
