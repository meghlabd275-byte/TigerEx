//! Secure storage module
//! 
//! Provides encrypted storage for sensitive data

use crate::crypto::AesEncryptor;
use crate::errors::{Result, SecurityError};
use serde::{de::DeserializeOwned, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Encrypted file storage
pub struct SecureStorage {
    encryptor: AesEncryptor,
    data: HashMap<String, Vec<u8>>,
}

impl SecureStorage {
    /// Create a new secure storage with the given key
    pub fn new(encryption_key: &[u8; 32]) -> Result<Self> {
        Ok(Self {
            encryptor: AesEncryptor::new(encryption_key)?,
            data: HashMap::new(),
        })
    }

    /// Store a value
    pub fn set(&mut self, key: &str, value: &[u8]) -> Result<()> {
        let encrypted = self.encryptor.encrypt(value)?;
        self.data.insert(key.to_string(), encrypted);
        Ok(())
    }

    /// Store a serializable value
    pub fn set_serialized<T: Serialize>(&mut self, key: &str, value: &T) -> Result<()> {
        let json = serde_json::to_vec(value)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        self.set(key, &json)
    }

    /// Get a value
    pub fn get(&self, key: &str) -> Result<Vec<u8>> {
        let encrypted = self.data.get(key)
            .ok_or_else(|| SecurityError::StorageError(format!("Key not found: {}", key)))?;
        
        self.encryptor.decrypt(encrypted)
    }

    /// Get a deserialized value
    pub fn get_deserialized<T: DeserializeOwned>(&self, key: &str) -> Result<T> {
        let data = self.get(key)?;
        serde_json::from_slice(&data)
            .map_err(|e| SecurityError::StorageError(e.to_string()))
    }

    /// Delete a value
    pub fn delete(&mut self, key: &str) -> Result<()> {
        self.data.remove(key)
            .ok_or_else(|| SecurityError::StorageError(format!("Key not found: {}", key)))?;
        Ok(())
    }

    /// Check if a key exists
    pub fn contains(&self, key: &str) -> bool {
        self.data.contains_key(key)
    }

    /// Get all keys
    pub fn keys(&self) -> Vec<String> {
        self.data.keys().cloned().collect()
    }

    /// Clear all data
    pub fn clear(&mut self) {
        self.data.clear();
    }

    /// Save to a file (encrypted)
    pub fn save_to_file<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let mut file = std::fs::File::create(path)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        let mut encoder = zstd::stream::write::Encoder::new(&mut file, 3)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        let json = serde_json::to_vec(&self.data)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        encoder.write_all(&json)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        encoder.finish()
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        Ok(())
    }

    /// Load from an encrypted file
    pub fn load_from_file<P: AsRef<Path>>(path: P, encryption_key: &[u8; 32]) -> Result<Self> {
        let file = std::fs::File::open(path)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        let mut decoder = zstd::stream::read::Decoder::new(file)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        let mut json = Vec::new();
        std::io::Read::read_to_end(&mut decoder, &mut json)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        let data: HashMap<String, Vec<u8>> = serde_json::from_slice(&json)
            .map_err(|e| SecurityError::StorageError(e.to_string()))?;
        
        Ok(Self {
            encryptor: AesEncryptor::new(encryption_key)?,
            data,
        })
    }
}

/// Sensitive data handler for PII
pub struct SensitiveDataHandler {
    storage: SecureStorage,
}

impl SensitiveDataHandler {
    pub fn new(encryption_key: &[u8; 32]) -> Result<Self> {
        Ok(Self {
            storage: SecureStorage::new(encryption_key)?,
        })
    }

    /// Store encrypted PII
    pub fn store_pii(&mut self, user_id: &str, pii_type: &str, data: &str) -> Result<()> {
        let key = format!("{}:{}", user_id, pii_type);
        self.storage.set(&key, data.as_bytes())
    }

    /// Retrieve PII
    pub fn get_pii(&self, user_id: &str, pii_type: &str) -> Result<String> {
        let key = format!("{}:{}", user_id, pii_type);
        let data = self.storage.get(&key)?;
        String::from_utf8(data)
            .map_err(|e| SecurityError::StorageError(e.to_string()))
    }

    /// Delete PII
    pub fn delete_pii(&mut self, user_id: &str, pii_type: &str) -> Result<()> {
        let key = format!("{}:{}", user_id, pii_type);
        self.storage.delete(&key)
    }
}

/// API key storage
pub struct APIKeyStore {
    storage: SecureStorage,
}

impl APIKeyStore {
    pub fn new(encryption_key: &[u8; 32]) -> Result<Self> {
        Ok(Self {
            storage: SecureStorage::new(encryption_key)?,
        })
    }

    /// Store an API key
    pub fn store_key(&mut self, user_id: &str, key_name: &str, key_data: &str) -> Result<()> {
        let key = format!("{}:{}", user_id, key_name);
        self.storage.set(&key, key_data.as_bytes())
    }

    /// Get an API key
    pub fn get_key(&self, user_id: &str, key_name: &str) -> Result<String> {
        let key = format!("{}:{}", user_id, key_name);
        let data = self.storage.get(&key)?;
        String::from_utf8(data)
            .map_err(|e| SecurityError::StorageError(e.to_string()))
    }

    /// Delete an API key
    pub fn delete_key(&mut self, user_id: &str, key_name: &str) -> Result<()> {
        let key = format!("{}:{}", user_id, key_name);
        self.storage.delete(&key)
    }

    /// List all keys for a user
    pub fn list_keys(&self, user_id: &str) -> Result<Vec<String>> {
        let prefix = format!("{}:", user_id);
        Ok(self.storage.keys().into_iter()
            .filter(|k| k.starts_with(&prefix))
            .map(|k| k.strip_prefix(&prefix).unwrap_or(&k).to_string())
            .collect())
    }
}

/// Secret rotation handler
pub struct SecretRotator {
    current_key: [u8; 32],
    storage: SecureStorage,
}

impl SecretRotator {
    pub fn new(initial_key: &[u8; 32]) -> Result<Self> {
        Ok(Self {
            current_key: *initial_key,
            storage: SecureStorage::new(initial_key)?,
        })
    }

    /// Rotate to a new key
    pub fn rotate(&mut self, new_key: &[u8; 32]) -> Result<()> {
        // Re-encrypt all data with new key
        let mut new_storage = SecureStorage::new(new_key)?;
        
        for key in self.storage.keys() {
            if let Ok(value) = self.storage.get(&key) {
                new_storage.set(&key, &value)?;
            }
        }
        
        self.current_key = *new_key;
        self.storage = new_storage;
        
        Ok(())
    }

    /// Get current key (for new encryptions)
    pub fn current_key(&self) -> [u8; 32] {
        self.current_key
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secure_storage() {
        let key = AesEncryptor::generate_key().unwrap();
        let mut storage = SecureStorage::new(&key).unwrap();
        
        storage.set("test", b"Hello, World!").unwrap();
        
        let value = storage.get("test").unwrap();
        assert_eq!(value, b"Hello, World!");
        
        assert!(storage.contains("test"));
        
        storage.delete("test").unwrap();
        assert!(!storage.contains("test"));
    }

    #[test]
    fn test_serialization() {
        let key = AesEncryptor::generate_key().unwrap();
        let mut storage = SecureStorage::new(&key).unwrap();
        
        #[derive(Serialize, Deserialize, Debug, PartialEq)]
        struct User {
            name: String,
            email: String,
        }
        
        let user = User {
            name: "John".to_string(),
            email: "john@example.com".to_string(),
        };
        
        storage.set_serialized("user", &user).unwrap();
        
        let retrieved: User = storage.get_deserialized("user").unwrap();
        assert_eq!(user, retrieved);
    }

    #[test]
    fn test_secret_rotation() {
        let key1 = AesEncryptor::generate_key().unwrap();
        let key2 = AesEncryptor::generate_key().unwrap();
        
        let mut rotator = SecretRotator::new(&key1).unwrap();
        
        rotator.storage.set("secret", b"important data").unwrap();
        
        // Rotate to new key
        rotator.rotate(&key2).unwrap();
        
        // Data should still be accessible with new key
        let mut new_rotator = SecretRotator::new(&key2).unwrap();
        let value = new_rotator.storage.get("secret").unwrap();
        assert_eq!(value, b"important data");
    }
}
