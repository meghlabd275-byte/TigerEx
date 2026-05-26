// Key Management System (KMS)
// Migrated from TypeScript to Rust for secure key management

use std::collections::HashMap;

// Key types
#[derive(Debug, Clone)]
pub enum KeyType {
    Master,
    Signing,
    Encryption,
    ColdWallet,
    HotWallet,
}

// Key status
#[derive(Debug, Clone)]
pub enum KeyStatus {
    Active,
    Rotated,
    Compromised,
    Destroyed,
}

// Cryptographic key
#[derive(Debug, Clone)]
pub struct Key {
    pub key_id: String,
    pub key_type: KeyType,
    pub public_key: Option<Vec<u8>>,
    pub created_at: i64,
    pub rotated_at: Option<i64>,
    pub status: KeyStatus,
    pub algorithm: String, // secp256k1, ed25519, RSA
}

// Key rotation policy
#[derive(Debug, Clone)]
pub struct RotationPolicy {
    pub key_type: KeyType,
    pub rotation_interval_days: i64,
    pub auto_rotate: bool,
}

// Signer
#[derive(Debug, Clone)]
pub struct Signer {
    pub signer_id: String,
    pub keys: Vec<String>, // Key IDs
    pub threshold: usize,
    pub parties: Vec<String>, // Party IDs required
}

// Key store
pub struct KeyStore {
    keys: HashMap<String, Key>,
    signers: HashMap<String, Signer>,
    rotation_policies: HashMap<String, RotationPolicy>,
}

impl KeyStore {
    pub fn new() -> Self {
        KeyStore {
            keys: HashMap::new(),
            signers: HashMap::new(),
            rotation_policies: HashMap::new(),
        }
    }

    // Generate master key
    pub fn generate_master_key(&mut self, algorithm: &str) -> String {
        let key_id = format!("master_{}", random_id());
        
        let key = Key {
            key_id: key_id.clone(),
            key_type: KeyType::Master,
            public_key: Some(vec![0u8; 33]), // Simplified
            created_at: now_ms(),
            rotated_at: None,
            status: KeyStatus::Active,
            algorithm: algorithm.to_string(),
        };
        
        self.keys.insert(key_id.clone(), key);
        key_id
    }

    // Generate signing key
    pub fn generate_signing_key(&mut self, master_key_id: &str) -> Option<String> {
        // Verify master key exists and is active
        if let Some(key) = self.keys.get(master_key_id) {
            if let KeyStatus::Active = key.status {
                let key_id = format!("sign_{}", random_id());
                
                let key = Key {
                    key_id: key_id.clone(),
                    key_type: KeyType::Signing,
                    public_key: Some(vec![0u8; 33]),
                    created_at: now_ms(),
                    rotated_at: None,
                    status: KeyStatus::Active,
                    algorithm: "secp256k1".to_string(),
                };
                
                self.keys.insert(key_id.clone(), key);
                return Some(key_id);
            }
        }
        None
    }

    // Rotate key
    pub fn rotate_key(&mut self, key_id: &str) -> Result<(), String> {
        if let Some(key) = self.keys.get_mut(key_id) {
            key.status = KeyStatus::Rotated;
            key.rotated_at = Some(now_ms());
            return Ok(());
        }
        Err("key not found".to_string())
    }

    // Mark as compromised
    pub fn compromise_key(&mut self, key_id: &str) -> Result<(), String> {
        if let Some(key) = self.keys.get_mut(key_id) {
            key.status = KeyStatus::Compromised;
            return Ok(());
        }
        Err("key not found".to_string())
    }

    // Create multisig signer
    pub fn create_signer(&mut self, keys: Vec<String>, threshold: usize, parties: Vec<String>) -> String {
        let signer_id = format!("signer_{}", random_id());
        
        let signer = Signer {
            signer_id: signer_id.clone(),
            keys,
            threshold,
            parties,
        };
        
        self.signers.insert(signer_id.clone(), signer);
        signer_id
    }

    // Verify threshold signatures
    pub fn verify_threshold(&self, signer_id: &str, signatures: usize) -> bool {
        if let Some(signer) = self.signers.get(signer_id) {
            return signatures >= signer.threshold;
        }
        false
    }

    // Get key status
    pub fn get_status(&self, key_id: &str) -> Option<KeyStatus> {
        self.keys.get(key_id).map(|k| k.status.clone())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn random_id() -> String {
    use std::iter;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789"
        .chars()
        .collect();
    
    iter::repeat_with(|| chars[0])
        .take(16)
        .map(|c| c)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_generation() {
        let mut ks = KeyStore::new();
        let master_key = ks.generate_master_key("secp256k1");
        assert!(!master_key.is_empty());
    }

    #[test]
    fn test_key_rotation() {
        let mut ks = KeyStore::new();
        let key_id = ks.generate_master_key("secp256k1");
        ks.rotate_key(&key_id).unwrap();
        
        if let Some(status) = ks.get_status(&key_id) {
            assert!(matches!(status, KeyStatus::Rotated));
        }
    }
}