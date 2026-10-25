//! HSM key service - real Ed25519 signing.
//!
//! The previous implementation returned `format!("key_{user_id}_hs256")` as a
//! "key", `format!("sig_{}", data.len())` as a signature, and had `verify`
//! hardcoded to `true`, so every signature was accepted and no key material
//! existed at all.

use std::collections::HashMap;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

/// Opaque, content-derived identifier for a key pair.
pub type KeyId = String;

/// A managed signing key. The secret is zeroized on drop.
pub struct HsmService {
    keys: HashMap<KeyId, Zeroizing<[u8; 32]>>,
}

impl HsmService {
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
        }
    }

    /// Generate a fresh Ed25519 key pair and return its id. The id is derived
    /// from the public key, so the same key always maps to the same id.
    pub fn generate_key(&mut self, label: &str) -> KeyId {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        let mut hasher = Sha256::new();
        hasher.update(verifying_key.as_bytes());
        hasher.update(label.as_bytes());
        let id = format!("key_{}", hex::encode(hasher.finalize()));

        self.keys.insert(id.clone(), Zeroizing::new(signing_key.to_bytes()));
        id
    }

    /// Public key bytes for a key id, or `None` when the id is unknown.
    pub fn public_key(&self, key_id: &str) -> Option<Vec<u8>> {
        let secret = self.keys.get(key_id)?;
        let signing_key = SigningKey::from_bytes(secret);
        Some(signing_key.verifying_key().to_bytes().to_vec())
    }

    /// Sign `data` with the named key. Fails for unknown key ids.
    pub fn sign(&self, key_id: &str, data: &str) -> Result<Vec<u8>, String> {
        let secret = self
            .keys
            .get(key_id)
            .ok_or_else(|| format!("unknown key id: {key_id}"))?;
        let signing_key = SigningKey::from_bytes(secret);
        Ok(signing_key.sign(data.as_bytes()).to_bytes().to_vec())
    }

    /// Verify a signature. Fails closed: unknown keys and malformed
    /// signatures return `false`.
    pub fn verify(&self, key_id: &str, data: &str, signature: &[u8]) -> bool {
        let Some(public) = self.public_key(key_id) else {
            return false;
        };
        let Ok(bytes) = <[u8; 32]>::try_from(public.as_slice()) else {
            return false;
        };
        let Ok(verifying_key) = VerifyingKey::from_bytes(&bytes) else {
            return false;
        };
        let Ok(signature) = Signature::from_slice(signature) else {
            return false;
        };
        verifying_key.verify(data.as_bytes(), &signature).is_ok()
    }
}

impl Default for HsmService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_verifies_for_the_signing_key() {
        let mut hsm = HsmService::new();
        let key = hsm.generate_key("custody");

        let sig = hsm.sign(&key, "transfer 1 BTC").unwrap();
        assert!(hsm.verify(&key, "transfer 1 BTC", &sig));
    }

    #[test]
    fn tampered_payload_or_signature_is_rejected() {
        let mut hsm = HsmService::new();
        let key = hsm.generate_key("custody");
        let sig = hsm.sign(&key, "transfer 1 BTC").unwrap();

        assert!(!hsm.verify(&key, "transfer 100 BTC", &sig));

        let mut bad = sig.clone();
        bad[0] ^= 0xff;
        assert!(!hsm.verify(&key, "transfer 1 BTC", &bad));
    }

    #[test]
    fn unknown_key_and_malformed_signature_fail_closed() {
        let mut hsm = HsmService::new();
        let key = hsm.generate_key("a");
        let sig = hsm.sign(&key, "x").unwrap();

        assert!(!hsm.verify("key_missing", "x", &sig));
        assert!(!hsm.verify(&key, "x", &[0u8; 3]));
    }

    #[test]
    fn keys_are_distinct_and_verification_is_key_specific() {
        let mut hsm = HsmService::new();
        let a = hsm.generate_key("a");
        let b = hsm.generate_key("b");
        assert_ne!(a, b);

        let sig = hsm.sign(&a, "msg").unwrap();
        assert!(!hsm.verify(&b, "msg", &sig));
    }
}
