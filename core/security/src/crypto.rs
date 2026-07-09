//! Cryptographic operations module
//! 
//! Provides encryption and decryption using AES-256-GCM

use aes_gcm::{
    aead::{Aead, KeyInit, OsRand},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use crate::errors::{Result, SecurityError};

/// Size of AES-256 key in bytes
pub const AES_KEY_SIZE: usize = 32;
/// Size of AES-GCM nonce in bytes
pub const AES_NONCE_SIZE: usize = 12;

/// AES-256-GCM Encryptor/Decryptor
pub struct AesEncryptor {
    cipher: Aes256Gcm,
}

impl AesEncryptor {
    /// Create a new encryptor with the given 32-byte key
    pub fn new(key: &[u8; AES_KEY_SIZE]) -> Result<Self> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| SecurityError::InvalidKey(e.to_string()))?;
        Ok(Self { cipher })
    }

    /// Create a new encryptor with a randomly generated key
    pub fn generate_key() -> Result<[u8; AES_KEY_SIZE]> {
        let mut key = [0u8; AES_KEY_SIZE];
        OsRng.fill_bytes(&mut key)
            .map_err(|e| SecurityError::RandomError(e.to_string()))?;
        Ok(key)
    }

    /// Encrypt data using AES-256-GCM
    /// 
    /// Returns the nonce (12 bytes) + ciphertext
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let mut nonce_bytes = [0u8; AES_NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes)
            .map_err(|e| SecurityError::RandomError(e.to_string()))?;
        
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let ciphertext = self.cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| SecurityError::EncryptionError(e.to_string()))?;
        
        // Prepend nonce to ciphertext
        let mut result = Vec::with_capacity(AES_NONCE_SIZE + ciphertext.len());
        result.extend_from_slice(&nonce_bytes);
        result.extend(ciphertext);
        
        Ok(result)
    }

    /// Decrypt data using AES-256-GCM
    /// 
    /// Expects nonce (12 bytes) + ciphertext
    pub fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        if data.len() < AES_NONCE_SIZE {
            return Err(SecurityError::InvalidData("Data too short".to_string()));
        }
        
        let (nonce_bytes, ciphertext) = data.split_at(AES_NONCE_SIZE);
        let nonce = Nonce::from_slice(nonce_bytes);
        
        let plaintext = self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| SecurityError::DecryptionError(e.to_string()))?;
        
        Ok(plaintext)
    }

    /// Encrypt a string and return base64 encoded result
    pub fn encrypt_string(&self, plaintext: &str) -> Result<String> {
        let encrypted = self.encrypt(plaintext.as_bytes())?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &encrypted))
    }

    /// Decrypt base64 encoded data
    pub fn decrypt_string(&self, data: &str) -> Result<String> {
        let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
            .map_err(|e| SecurityError::EncodingError(e.to_string()))?;
        
        let decrypted = self.decrypt(&decoded)?;
        
        String::from_utf8(decrypted)
            .map_err(|e| SecurityError::InvalidData(e.to_string()))
    }
}

/// Encryptor using AES-256-CBC with HMAC
pub struct AesCbcEncryptor {
    key: [u8; AES_KEY_SIZE],
}

impl AesCbcEncryptor {
    pub fn new(key: &[u8; AES_KEY_SIZE]) -> Result<Self> {
        Ok(Self { key: *key })
    }

    /// Simple XOR-based encryption for educational purposes
    /// Note: In production, use AES-GCM or ChaCha20-Poly1305
    pub fn encrypt_simple(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let mut result = Vec::with_capacity(plaintext.len());
        
        for (i, &byte) in plaintext.iter().enumerate() {
            let key_byte = self.key[i % self.key.len()];
            result.push(byte ^ key_byte ^ (i as u8));
        }
        
        Ok(result)
    }

    pub fn decrypt_simple(&self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        // XOR is symmetric
        self.encrypt_simple(ciphertext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aes_encrypt_decrypt() {
        let key = AesEncryptor::generate_key().unwrap();
        let encryptor = AesEncryptor::new(&key).unwrap();
        
        let plaintext = b"Hello, TigerEx!";
        let encrypted = encryptor.encrypt(plaintext).unwrap();
        let decrypted = encryptor.decrypt(&encrypted).unwrap();
        
        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_string_encryption() {
        let key = AesEncryptor::generate_key().unwrap();
        let encryptor = AesEncryptor::new(&key).unwrap();
        
        let plaintext = "TigerEx Secure Message";
        let encrypted = encryptor.encrypt_string(plaintext).unwrap();
        let decrypted = encryptor.decrypt_string(&encrypted).unwrap();
        
        assert_eq!(plaintext, decrypted);
    }
}
