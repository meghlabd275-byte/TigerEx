//! Crypto Utilities - Rust Implementation
//! High-performance cryptography operations for TigerEx

use sha2::{Sha256, Digest};
use hmac::{Hmac, Mac};
use base64::{Engine as _, engine::general_purpose};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use rand::Rng;
use serde::{Serialize, Deserialize};

/// HMAC-SHA256 type
type HmacSha256 = Hmac<Sha256>;

/// SHA256 hash
pub fn sha256(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// HMAC-SHA256
pub fn hmac_sha256(key: &str, data: &str) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(key.as_bytes())
        .map_err(|e| format!("HMAC error: {}", e))?;
    
    mac.update(data.as_bytes());
    
    Ok(format!("{:x}", mac.finalize()))
}

/// Base64 encode
pub fn encode_base64(data: &str) -> String {
    general_purpose::STANDARD.encode(data.as_bytes())
}

/// Base64 decode
pub fn decode_base64(data: &str) -> Result<String, String> {
    let decoded = general_purpose::STANDARD.decode(data.as_bytes())
        .map_err(|e| format!("Decode error: {}", e))?;
    
    String::from_utf8(decoded)
        .map_err(|e| format!("UTF8 error: {}", e))
}

/// AES-GCM encryption
pub fn aes_encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    
    let mut rng = rand::thread_rng();
    let nonce_bytes: [u8; 12] = rng.gen();
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher.encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption error: {}", e))?;
    
    Ok((ciphertext, nonce_bytes.to_vec()))
}

/// AES-GCM decryption
pub fn aes_decrypt(key: &[u8; 32], ciphertext: &[u8], nonce: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce);
    
    cipher.decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption error: {}", e))
}

/// Generate random key
pub fn generate_key() -> [u8; 32] {
    let mut rng = rand::thread_rng();
    let mut key = [0u8; 32];
    rng.fill(&mut key);
    key
}

/// Generate random nonce (12 bytes for GCM)
pub fn generate_nonce() -> [u8; 12] {
    let mut rng = rand::thread_rng();
    let mut nonce = [0u8; 12];
    rng.fill(&mut nonce);
    nonce
}

/// Verify HMAC signature
pub fn verify_hmac(key: &str, data: &str, signature: &str) -> bool {
    match hmac_sha256(key, data) {
        Ok sig) => sig == signature,
        Err(_) => false,
    }
}

/// Hash structure for serialization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashResult {
    pub algorithm: String,
    pub hash: String,
}

/// Encrypt request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptRequest {
    pub data: String,
    pub key: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256() {
        let hash = sha256("test");
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_hmac_sha256() {
        let key = "secret";
        let data = "message";
        let sig = hmac_sha256(key, data).unwrap();
        assert_eq!(sig.len(), 64);
    }

    #[test]
    fn test_base64() {
        let encoded = encode_base64("Hello World");
        let decoded = decode_base64(&encoded).unwrap();
        assert_eq!(decoded, "Hello World");
    }

    #[test]
    fn test_aes_encrypt() {
        let key = generate_key();
        let plaintext = b"Secret message";
        let (ciphertext, nonce) = aes_encrypt(&key, plaintext).unwrap();
        let decrypted = aes_decrypt(&key, &ciphertext, &nonce).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_verify_hmac() {
        let key = "key";
        let data = "data";
        let sig = hmac_sha256(key, data).unwrap();
        assert!(verify_hmac(key, data, &sig));
    }
}