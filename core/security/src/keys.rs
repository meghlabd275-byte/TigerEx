//! Key management module
//! 
//! Provides key generation, derivation, and management

use crate::errors::{Result, SecurityError};
use crate::crypto::AesEncryptor;
use sha2::{Sha256, Digest};
use rand::RngCore;
use std::collections::HashMap;
use std::sync::RwLock;

/// Key derivation function using HKDF-like approach
pub struct KeyDeriver;

impl KeyDeriver {
    /// Derive a subkey from a master key
    /// 
    /// Uses SHA-256 with a context string to derive unique keys
    pub fn derive_key(master_key: &[u8], context: &str) -> Vec<u8> {
        let mut hasher = Sha256::new();
        hasher.update(master_key);
        hasher.update(context.as_bytes());
        hasher.update(b"TIGEREX_KEY_DERIVATION_V1");
        hasher.finalize().to_vec()
    }

    /// Derive multiple keys from a master key
    pub fn derive_keys(master_key: &[u8], contexts: &[&str]) -> Vec<Vec<u8>> {
        contexts.iter()
            .map(|ctx| Self::derive_key(master_key, ctx))
            .collect()
    }
}

/// Master key manager for secure key storage
pub struct KeyManager {
    keys: RwLock<HashMap<String, Vec<u8>>>,
    encryption_key: Vec<u8>,
}

impl KeyManager {
    /// Create a new key manager
    pub fn new(encryption_key: &[u8]) -> Result<Self> {
        Ok(Self {
            keys: RwLock::new(HashMap::new()),
            encryption_key: encryption_key.to_vec(),
        })
    }

    /// Store a key securely
    pub fn store_key(&self, name: &str, key: &[u8]) -> Result<()> {
        let encryptor = AesEncryptor::new(
            &self.encryption_key.try_into()
                .map_err(|_| SecurityError::InvalidKey("Invalid key length".to_string()))?
        )?;
        
        let encrypted = encryptor.encrypt(key)?;
        
        let mut keys = self.keys.write()
            .map_err(|_| SecurityError::StorageError("Lock error".to_string()))?;
        
        keys.insert(name.to_string(), encrypted);
        
        Ok(())
    }

    /// Retrieve a key
    pub fn get_key(&self, name: &str) -> Result<Vec<u8>> {
        let keys = self.keys.read()
            .map_err(|_| SecurityError::StorageError("Lock error".to_string()))?;
        
        let encrypted = keys.get(name)
            .ok_or_else(|| SecurityError::InvalidKey(format!("Key not found: {}", name)))?;
        
        let encryptor = AesEncryptor::new(
            &self.encryption_key.try_into()
                .map_err(|_| SecurityError::InvalidKey("Invalid key length".to_string()))?
        )?;
        
        encryptor.decrypt(encrypted)
    }

    /// Delete a key
    pub fn delete_key(&self, name: &str) -> Result<()> {
        let mut keys = self.keys.write()
            .map_err(|_| SecurityError::StorageError("Lock error".to_string()))?;
        
        keys.remove(name);
        
        Ok(())
    }

    /// Check if a key exists
    pub fn has_key(&self, name: &str) -> bool {
        self.keys.read()
            .map(|keys| keys.contains_key(name))
            .unwrap_or(false)
    }
}

/// Hot wallet key manager
pub struct HotWalletKeys {
    signing_key: Vec<u8>,
    encryption_key: Vec<u8>,
    public_key: Vec<u8>,
}

impl HotWalletKeys {
    /// Generate new hot wallet keys
    pub fn generate() -> Result<Self> {
        // Generate random keys (in production, use proper key generation)
        let mut signing_key = vec![0u8; 32];
        let mut encryption_key = vec![0u8; 32];
        let mut public_key = vec![0u8; 32];
        
        rand::OsRng.fill_bytes(&mut signing_key)
            .map_err(|e| SecurityError::RandomError(e.to_string()))?;
        rand::OsRng.fill_bytes(&mut encryption_key)
            .map_err(|e| SecurityError::RandomError(e.to_string()))?;
        rand::OsRng.fill_bytes(&mut public_key)
            .map_err(|e| SecurityError::RandomError(e.to_string()))?;
        
        Ok(Self {
            signing_key,
            encryption_key,
            public_key,
        })
    }

    /// Get the signing key
    pub fn signing_key(&self) -> &[u8] {
        &self.signing_key
    }

    /// Get the encryption key
    pub fn encryption_key(&self) -> &[u8] {
        &self.encryption_key
    }

    /// Get the public key
    pub fn public_key(&self) -> &[u8] {
        &self.public_key
    }
}

/// Cold wallet key manager
pub struct ColdWalletKeys {
    // Multi-sig keys would be stored here
    threshold: usize,
    total_keys: usize,
}

impl ColdWalletKeys {
    pub fn new(threshold: usize, total_keys: usize) -> Self {
        Self { threshold, total_keys }
    }

    pub fn threshold(&self) -> usize {
        self.threshold
    }

    pub fn total_keys(&self) -> usize {
        self.total_keys
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_derivation() {
        let master_key = b"master_key_32_bytes_long_______";
        let key1 = KeyDeriver::derive_key(master_key, "context1");
        let key2 = KeyDeriver::derive_key(master_key, "context2");
        
        assert_ne!(key1, key2);
        assert_eq!(key1.len(), 32);
        assert_eq!(key2.len(), 32);
    }

    #[test]
    fn test_key_manager() {
        let enc_key = AesEncryptor::generate_key().unwrap();
        let manager = KeyManager::new(&enc_key).unwrap();
        
        let key = b"test_key_32_bytes_long_______";
        manager.store_key("test", key).unwrap();
        
        let retrieved = manager.get_key("test").unwrap();
        assert_eq!(key.to_vec(), retrieved);
        
        assert!(manager.has_key("test"));
        manager.delete_key("test").unwrap();
        assert!(!manager.has_key("test"));
    }
}
