//! TigerEx Crypto Utilities - Rust Implementation
//! 
//! Cryptographic utilities for secure operations

use ring::digest;
use ring::rand::SecureRandom;
use ring::hmac;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

// ============================================================================
// HASHING
// ============================================================================

/// Blake3 hash (using digest module for SHA-256 compatibility)
pub fn hash_sha256(data: &[u8]) -> Vec<u8> {
    let digest = digest::digest(&digest::SHA256, data);
    digest.as_ref().to_vec()
}

/// Blake3 hash as hex string
pub fn hash_sha256_hex(data: &[u8]) -> String {
    hex_encode(&hash_sha256(data))
}

/// SHA-512 hash
pub fn hash_sha512(data: &[u8]) -> Vec<u8> {
    let digest = digest::digest(&digest::SHA512, data);
    digest.as_ref().to_vec()
}

/// Generate secure random bytes
pub fn random_bytes(len: usize) -> Result<Vec<u8>, ()> {
    let rng = ring::rand::SystemRandom::new();
    let mut bytes = vec![0u8; len];
    rng.fill(&mut bytes).map_err(|_| ())?;
    Ok(bytes)
}

/// Generate secure random hex string
pub fn random_hex(len: usize) -> Result<String, ()> {
    let bytes = random_bytes(len)?;
    Ok(hex_encode(&bytes))
}

/// HMAC-SHA256
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let key = hmac::Key::new(hmac::HMAC_SHA256, key);
    let tag = hmac::sign(&key, data);
    tag.as_ref().to_vec()
}

/// Verify HMAC
pub fn hmac_verify(key: &[u8], data: &[u8], expected: &[u8]) -> bool {
    let key = hmac::Key::new(hmac::HMAC_SHA256, key);
    let tag = hmac::sign(&key, data);
    tag.as_ref() == expected
}

// ============================================================================
// HELPERS
// ============================================================================

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash() {
        let hash = hash_sha256(b"hello");
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_random() {
        let bytes = random_bytes(32).unwrap();
        assert_eq!(bytes.len(), 32);
    }
}
