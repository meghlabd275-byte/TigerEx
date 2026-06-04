/**
 * TigerEx Rust Security Module
 * Security-critical operations: encryption, key derivation, MPC
 */

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{password_hash::SaltString, Argon2, PasswordHasher, PasswordVerifier};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::{rngs::OsRng, RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;
use sha2::{Digest, Sha256, Sha512};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use threshold_ecdsa::{gg20::sign as threshold_sign, key_gen};
use zeroize::Zeroizing;

// ============================================================================
// KEY DERIVATION & ENCRYPTION
// ============================================================================

/// Derive encryption key from password using Argon2id
pub fn derive_key(password: &str, salt: &[u8]) -> Vec<u8> {
    let argon2 = Argon2::default();
    let salt_str = SaltString::encode_b64(salt).unwrap();
    let hash = argon2.hash_password(password.as_bytes(), &salt_str).unwrap();
    hash.hash.unwrap().as_bytes().to_vec()
}

/// Encrypt data with AES-256-GCM
pub fn encrypt(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Cipher error: {}", e))?;
    
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher.encrypt(nonce, plaintext)
        .map_err(|e| format!("Encrypt error: {}", e))?;
    
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);
    Ok(result)
}

/// Decrypt data with AES-256-GCM
pub fn decrypt(ciphertext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if ciphertext.len() < 12 {
        return Err("Ciphertext too short".to_string());
    }
    
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Cipher error: {}", e))?;
    
    let nonce = Nonce::from_slice(&ciphertext[..12]);
    let encrypted = &ciphertext[12..];
    
    cipher.decrypt(nonce, encrypted)
        .map_err(|e| format!("Decrypt error: {}", e))
}

/// SHA-256 hash
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// SHA-512 hash
pub fn sha512(data: &[u8]) -> [u8; 64] {
    let mut hasher = Sha512::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// HMAC-SHA256
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    use std::io::Write;
    
    let mut inner = Sha256::new();
    let block_size = 64;
    
    let mut key_block = vec![0u8; block_size];
    if key.len() > block_size {
        let hashed_key = sha256(key);
        key_block[..32].copy_from_slice(&hashed_key);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    
    for (i, byte) in key_block.iter_mut().enumerate() {
        *byte ^= 0x5c;
    }
    
    let mut o_key_pad = key_block.clone();
    
    for (i, byte) in key_block.iter_mut().enumerate() {
        *byte ^= 0x5c ^ 0x36;
    }
    
    inner.update(&key_block);
    inner.update(data);
    let inner_hash = inner.finalize();
    
    let mut outer = Sha256::new();
    outer.update(&o_key_pad);
    outer.update(&inner_hash);
    outer.finalize().into()
}

// ============================================================================
// ED25519 SIGNING
// ============================================================================

/// Generate Ed25519 keypair
pub fn generate_keypair() -> (SigningKey, VerifyingKey) {
    let signing_key = SigningKey::generate(&mut OsRng);
    (signing_key, signing_key.verifying_key())
}

/// Sign message with Ed25519
pub fn sign(message: &[u8], signing_key: &SigningKey) -> Signature {
    signing_key.sign(message)
}

/// Verify Ed25519 signature
pub fn verify(message: &[u8], signature: &Signature, verifying_key: &VerifyingKey) -> bool {
    verifying_key.verify(message, signature).is_ok()
}

// ============================================================================
// MNEMONIC & SEED PHRASE (BIP39)
// ============================================================================

/// Word list for BIP39 (first 100 words for demo - full list has 2048)
const BIP39_WORDS: &[&str] = &[
    "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse",
    "access", "accident", "account", "accuse", "achieve", "acid", "acoustic", "acquire", "across", "act",
    "action", "actor", "actress", "actual", "adapt", "add", "addict", "address", "adjust", "admit",
    "adult", "advance", "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
    "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album", "alcohol", "alert",
    "alien", "all", "alley", "allow", "almost", "alone", "alpha", "already", "also", "alter",
    "always", "amateur", "amazing", "among", "amount", "amused", "analyst", "anchor", "ancient", "anger",
    "angle", "angry", "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
    "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april", "arch", "arctic",
    "area", "arena", "argue", "arm", "armed", "armor", "army", "around", "arrange", "arrest",
];

/// Generate mnemonic phrase (12-24 words)
pub fn generate_mnemonic(words: usize) -> Result<Vec<String>, String> {
    if words < 12 || words > 24 || words % 3 != 0 {
        return Err("Mnemonic must be 12, 15, 18, 21, or 24 words".to_string());
    }
    
    let entropy_bits = (words / 3) * 32 * 4;
    let mut entropy = vec![0u8; entropy_bits / 8];
    OsRng.fill_bytes(&mut entropy);
    
    let checksum = Sha256::digest(&entropy);
    let checksum_bits = entropy_bits / 32;
    
    let mut bits = Vec::new();
    for byte in &entropy {
        for i in (0..8).rev() {
            bits.push((*byte >> i) & 1);
        }
    }
    
    for i in 0..checksum_bits {
        bits.push((checksum[i / 8] >> (7 - (i % 8))) & 1);
    }
    
    let mut mnemonic = Vec::new();
    for chunk in bits.chunks(11) {
        let index = chunk.iter().fold(0, |acc, &b| (acc << 1) | b);
        if (index as usize) < BIP39_WORDS.len() {
            mnemonic.push(BIP39_WORDS[index as usize].to_string());
        }
    }
    
    Ok(mnemonic)
}

/// Derive seed from mnemonic (BIP39)
pub fn mnemonic_to_seed(mnemonic: &[String], passphrase: &str) -> Vec<u8> {
    let phrase = mnemonic.join(" ");
    let salt = format!("mnemonic{}", passphrase);
    
    // Use PBKDF2 with 2048 iterations
    let mut seed = vec![0u8; 64];
    pbkdf2_simple(phrase.as_bytes(), salt.as_bytes(), 2048, &mut seed);
    
    seed
}

/// Simple PBKDF2 implementation
fn pbkdf2_simple(password: &[u8], salt: &[u8], iterations: usize, output: &mut [u8]) {
    let mut block = vec![0u8; salt.len() + 4];
    block[..salt.len()].copy_from_slice(salt);
    
    let mut u = hmac_sha256(password, &block);
    output.copy_from_slice(&u);
    
    for _ in 1..iterations {
        u = hmac_sha256(password, &u);
        for (i, byte) in u.iter().enumerate() {
            output[i] ^= byte;
        }
    }
}

// ============================================================================
// WALLET GENERATION (BIP44)
// ============================================================================

/// HD Wallet structure
pub struct HDWallet {
    pub master_seed: Vec<u8>,
    pub master_key: [u8; 64],
}

impl HDWallet {
    /// Create wallet from seed
    pub fn from_seed(seed: &[u8]) -> Self {
        let hmac = hmac_sha256(b"Bitcoin seed", seed);
        let mut master_key = [0u8; 64];
        master_key.copy_from_slice(&hmac);
        
        HDWallet {
            master_seed: seed.to_vec(),
            master_key,
        }
    }
    
    /// Derive child key (BIP44)
    pub fn derive_path(&self, path: &str) -> [u8; 64] {
        let mut key = self.master_key;
        
        // Parse path like m/44'/0'/0'/0/0
        let parts: Vec<&str> = path.split('/').collect();
        
        for part in parts {
            let hardened = part.ends_with('\'');
            let index: u32 = part.trim_end_matches('\'').parse().unwrap_or(0);
            
            key = self.derive_child_key(&key, index, hardened);
        }
        
        key
    }
    
    fn derive_child_key(&self, parent_key: &[u8; 64], index: u32, hardened: bool) -> [u8; 64] {
        let mut data = vec![];
        
        if hardened {
            data.push(0);
        }
        
        data.extend_from_slice(parent_key);
        data.extend_from_slice(&index.to_be_bytes());
        
        hmac_sha256(&parent_key[32..64], &data)
    }
    
    /// Generate Ethereum address from private key
    pub fn eth_address(&self, path: &str) -> String {
        let child_key = self.derive_path(path);
        
        // Simplified - real implementation would use secp256k1
        let hash = sha256(&child_key[32..64]);
        let address = &hash[12..32];
        
        format!("0x{}", hex::encode(address))
    }
    
    /// Generate Bitcoin address from private key
    pub fn btc_address(&self, path: &str) -> String {
        let child_key = self.derive_path(path);
        
        // Simplified - real implementation would use secp256k1 + base58
        let hash = sha256(&child_key[32..64]);
        format!("1{}", hex::encode(&hash[..20]))
    }
}

// ============================================================================
// MULTI-SIGNATURE (MULTISIG)
// ============================================================================

/// Multisig wallet structure
pub struct MultisigWallet {
    pub threshold: usize,
    pub pubkeys: Vec<[u8; 32]>,
    pub address: String,
}

impl MultisigWallet {
    /// Create multisig wallet
    pub fn new(threshold: usize, pubkeys: Vec<[u8; 32]>) -> Self {
        assert!(threshold <= pubkeys.len());
        
        let mut address_data = vec![];
        for pk in &pubkeys {
            address_data.extend_from_slice(pk);
        }
        address_data.push(threshold as u8);
        
        let hash = sha256(&address_data);
        let address = format!("M{}", hex::encode(&hash[..20]));
        
        MultisigWallet {
            threshold,
            pubkeys,
            address,
        }
    }
    
    /// Create signature share (simplified - real would use GG20)
    pub fn sign(&self, message: &[u8], key_index: usize) -> Vec<u8> {
        if key_index >= self.pubkeys.len() {
            return vec![];
        }
        
        let sig = hmac_sha256(&self.pubkeys[key_index], message);
        sig.to_vec()
    }
}

// ============================================================================
// SECURE STORAGE
// ============================================================================

/// Secure in-memory storage with encryption
pub struct SecureStorage {
    data: RwLock<HashMap<String, Vec<u8>>>,
    master_key: [u8; 32],
}

impl SecureStorage {
    pub fn new(password: &str) -> Self {
        let salt = b"TigerExSecureStorage2024";
        let key = derive_key(password, salt);
        
        let mut master_key = [0u8; 32];
        master_key.copy_from_slice(&key[..32]);
        
        SecureStorage {
            data: RwLock::new(HashMap::new()),
            master_key,
        }
    }
    
    pub fn set(&self, key: &str, value: &[u8]) -> Result<(), String> {
        let encrypted = encrypt(value, &self.master_key)?;
        
        let mut data = self.data.write().unwrap();
        data.insert(key.to_string(), encrypted);
        
        Ok(())
    }
    
    pub fn get(&self, key: &str) -> Result<Vec<u8>, String> {
        let data = self.data.read().unwrap();
        
        let encrypted = data.get(key)
            .ok_or_else(|| "Key not found".to_string())?;
        
        decrypt(encrypted, &self.master_key)
    }
    
    pub fn delete(&self, key: &str) -> Result<(), String> {
        let mut data = self.data.write().unwrap();
        data.remove(key);
        Ok(())
    }
}

// ============================================================================
// TIME-LOCKED ENCRYPTION
// ============================================================================

/// Time-locked encryption for secure withdrawal delays
pub struct TimeLock {
    pub unlock_time: u64,
    pub encrypted_data: Vec<u8>,
}

impl TimeLock {
    /// Create time-locked data (48-hour delay for security changes)
    pub fn create(data: &[u8], hours: u64) -> Self {
        let unlock_time = std::time::SystemTime::now()
            .checked_add(std::time::Duration::from_secs(hours * 3600))
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // In production, use actual encryption with timelock algorithm
        let encrypted = encrypt(data, b"TigerExTimelockSecretKey1234").unwrap();
        
        TimeLock {
            unlock_time,
            encrypted_data: encrypted,
        }
    }
    
    /// Check if unlockable
    pub fn can_unlock(&self) -> bool {
        let current = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        current >= self.unlock_time
    }
}

// ============================================================================
// ENCRYPTED SESSION
// ============================================================================

/// Encrypted session token
pub struct SessionToken {
    pub user_id: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub encrypted_payload: Vec<u8>,
}

impl SessionToken {
    pub fn create(user_id: &str, duration_hours: u64) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let payload = format!("{}:{}:{}", user_id, now, now + duration_hours * 3600);
        let encrypted = encrypt(payload.as_bytes(), b"TigerExSessionSecretKey123").unwrap();
        
        SessionToken {
            user_id: user_id.to_string(),
            created_at: now,
            expires_at: now + duration_hours * 3600,
            encrypted_payload: encrypted,
        }
    }
    
    pub fn validate(&self) -> bool {
        let current = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        current < self.expires_at
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_encryption() {
        let key = [0u8; 32];
        let plaintext = b"Hello, TigerEx!";
        
        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        
        assert_eq!(plaintext.to_vec(), decrypted);
    }
    
    #[test]
    fn test_mnemonic() {
        let mnemonic = generate_mnemonic(24).unwrap();
        assert_eq!(mnemonic.len(), 24);
    }
    
    #[test]
    fn test_hd_wallet() {
        let seed = vec![0u8; 32];
        let wallet = HDWallet::from_seed(&seed);
        
        let eth_addr = wallet.eth_address("m/44'/60'/0'/0/0");
        assert!(eth_addr.starts_with("0x"));
    }
    
    #[test]
    fn test_multisig() {
        let pubkeys = vec![[0u8; 32]; 3];
        let wallet = MultisigWallet::new(2, pubkeys);
        
        assert_eq!(wallet.threshold, 2);
    }
}
