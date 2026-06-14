//! TigerEx Security Module - Complete Cryptographic Implementation
//! All security primitives for a production exchange
//! Uses Rust for memory safety and cryptographic correctness

use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use digest::{Digest, FixedOutput};
use hmac::{Hmac, Mac};
use rand::RngCore;
use rsa::{
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding},
    Pkcs1v15Encrypt, RsaPrivateKey, RsaPublicKey,
};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Sha512};
use thiserror::Error;
use x25519_dalek::{EphemeralSecret, PublicKey as X25519PublicKey, StaticSecret};

/// Security errors
#[derive(Debug, Error)]
pub enum SecurityError {
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("Key derivation failed: {0}")]
    KeyDerivationFailed(String),
    #[error("Invalid key: {0}")]
    InvalidKey(String),
    #[error("Random generation failed: {0}")]
    RandomError(String),
    #[error("Hash verification failed")]
    HashMismatch,
    #[error("Encoding error: {0}")]
    EncodingError(String),
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    #[error("Access denied: {0}")]
    AccessDenied(String),
}

pub type Result<T> = std::result::Result<T, SecurityError>;

// Constants
pub const KEY_SIZE_256: usize = 32;
pub const KEY_SIZE_512: usize = 64;
pub const NONCE_SIZE: usize = 12;
pub const SALT_SIZE: usize = 16;

// ============================================================================
// RANDOM GENERATION
// ============================================================================

/// Generate cryptographically secure random bytes
pub fn generate_random_bytes(size: usize) -> Result<Vec<u8>> {
    let mut bytes = vec![0u8; size];
    OsRng.fill_bytes(&mut bytes)
        .map_err(|e| SecurityError::RandomError(e.to_string()))?;
    Ok(bytes)
}

/// Generate random string
pub fn generate_random_string(length: usize) -> Result<String> {
    let bytes = generate_random_bytes(length)?;
    Ok(BASE64.encode(&bytes)[..length].to_string())
}

// ============================================================================
// HMAC
// ============================================================================

type HmacSha256 = Hmac<Sha256>;
type HmacSha512 = Hmac<Sha512>;

/// HMAC-SHA256
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take any key size");
    mac.update(message);
    mac.finalize().into_bytes().to_vec()
}

/// HMAC-SHA512
pub fn hmac_sha512(key: &[u8], message: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha512::new_from_slice(key).expect("HMAC can take any key size");
    mac.update(message);
    mac.finalize().into_bytes().to_vec()
}

/// Verify HMAC
pub fn verify_hmac(key: &[u8], message: &[u8], expected: &[u8]) -> bool {
    hmac_sha256(key, message) == expected
}

// ============================================================================
// SHA HASHING
// ============================================================================

/// SHA-256
pub fn sha256(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize_fixed().to_vec()
}

/// SHA-512
pub fn sha512(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha512::new();
    hasher.update(data);
    hasher.finalize_fixed().to_vec()
}

/// Double SHA-256 (Bitcoin style)
pub fn double_sha256(data: &[u8]) -> Vec<u8> {
    sha256(&sha256(data))
}

/// SHA-256 hex
pub fn sha256_hex(data: &[u8]) -> String {
    hex_encode(&sha256(data))
}

// ============================================================================
// AES-256-GCM ENCRYPTION
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedData {
    pub nonce: String,
    pub ciphertext: String,
    pub tag: String,
}

pub struct AesEncryptor {
    key: [u8; KEY_SIZE_256],
}

impl AesEncryptor {
    pub fn new(key: &[u8; KEY_SIZE_256]) -> Self {
        Self { key: *key }
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedData> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| SecurityError::EncryptionFailed(e.to_string()))?;

        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes)
            .map_err(|e| SecurityError::RandomError(e.to_string()))?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| SecurityError::EncryptionFailed(e.to_string()))?;

        let (ct, tag) = ciphertext.split_at(ciphertext.len() - 16);
        
        Ok(EncryptedData {
            nonce: BASE64.encode(nonce_bytes),
            ciphertext: BASE64.encode(ct),
            tag: BASE64.encode(tag),
        })
    }

    pub fn decrypt(&self, data: &EncryptedData) -> Result<Vec<u8>> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| SecurityError::DecryptionFailed(e.to_string()))?;

        let nonce_bytes = BASE64.decode(&data.nonce)
            .map_err(|e| SecurityError::DecryptionFailed(e.to_string()))?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        let mut ciphertext = BASE64.decode(&data.ciphertext)
            .map_err(|e| SecurityError::DecryptionFailed(e.to_string()))?;
        
        let tag = BASE64.decode(&data.tag)
            .map_err(|e| SecurityError::DecryptionFailed(e.to_string()))?;
        ciphertext.extend_from_slice(&tag);

        cipher.decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| SecurityError::DecryptionFailed(e.to_string()))
    }
}

pub fn generate_aes_key() -> Result<[u8; KEY_SIZE_256]> {
    let mut key = [0u8; KEY_SIZE_256];
    OsRng.fill_bytes(&mut key)
        .map_err(|e| SecurityError::RandomError(e.to_string()))?;
    Ok(key)
}

// ============================================================================
// ARGON2 KEY DERIVATION
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParams {
    pub salt: String,
    pub iterations: u32,
    pub memory_kb: u32,
    pub parallelism: u32,
    pub hash_len: usize,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            salt: BASE64.encode(&generate_random_bytes(SALT_SIZE).unwrap()),
            iterations: 3,
            memory_kb: 65536,
            parallelism: 4,
            hash_len: 64,
        }
    }
}

pub fn derive_key_argon2(password: &str, params: &KdfParams) -> Result<Vec<u8>> {
    let salt = BASE64.decode(&params.salt)
        .map_err(|e| SecurityError::KeyDerivationFailed(e.to_string()))?;
    
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(
            params.memory_kb,
            params.iterations,
            params.parallelism,
            Some(params.hash_len),
        ).map_err(|e| SecurityError::KeyDerivationFailed(e.to_string()))?,
    );

    let hash = argon2.hash_password(password.as_bytes(), &SaltString::encode_b64(&salt))
        .map_err(|e| SecurityError::KeyDerivationFailed(e.to_string()))?;
    
    Ok(hash.hash.unwrap().as_bytes().to_vec())
}

pub fn derive_key_hkdf(master_key: &[u8], info: &[u8], length: usize) -> Vec<u8> {
    let mut okm = vec![0u8; length + 32];
    hkdf::Hkdf::<Sha256>::new(Some(info), master_key)
        .expand(&[], &mut okm)
        .expect("HKDF expand should not fail");
    okm[..length].to_vec()
}

// ============================================================================
// RSA ENCRYPTION
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RsaKeyPair {
    pub public_key_pem: String,
    pub private_key_pem: String,
}

pub fn generate_rsa_keypair() -> Result<RsaKeyPair> {
    let mut rng = rand::thread_rng();
    let bits = 4096;
    
    let private_key = RsaPrivateKey::new(&mut rng, bits)
        .map_err(|e| SecurityError::InvalidKey(e.to_string()))?;
    
    let public_key = RsaPublicKey::from(&private_key);
    
    let private_pem = private_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| SecurityError::InvalidKey(e.to_string()))?
        .to_string();
    
    let public_pem = public_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| SecurityError::InvalidKey(e.to_string()))?;
    
    Ok(RsaKeyPair {
        public_key_pem: public_pem,
        private_key_pem: private_pem,
    })
}

pub fn rsa_encrypt(public_key_pem: &str, plaintext: &[u8]) -> Result<Vec<u8>> {
    let public_key = RsaPublicKey::from_public_key_pem(public_key_pem)
        .map_err(|e| SecurityError::InvalidKey(e.to_string()))?;
    
    let mut rng = rand::thread_rng();
    let encrypter = Pkcs1v15Encrypt::new(&rng);
    
    public_key.encrypt(&mut rng, encrypter, plaintext)
        .map_err(|e| SecurityError::EncryptionFailed(e.to_string()))
}

pub fn rsa_decrypt(private_key_pem: &str, ciphertext: &[u8]) -> Result<Vec<u8>> {
    let private_key = RsaPrivateKey::from_pkcs8_pem(private_key_pem)
        .map_err(|e| SecurityError::InvalidKey(e.to_string()))?;
    
    let decrypter = Pkcs1v15Encrypt::new(&SHA256::new());
    
    private_key.decrypt(decrypter, ciphertext)
        .map_err(|e| SecurityError::DecryptionFailed(e.to_string()))
}

// ============================================================================
// X25519 KEY EXCHANGE
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X25519KeyPair {
    pub public_key: String,
    pub private_key: String,
}

pub fn generate_x25519_keypair() -> Result<X25519KeyPair> {
    let private_key = StaticSecret::random_from_rng(OsRng);
    let public_key = X25519PublicKey::from(&private_key);
    
    Ok(X25519KeyPair {
        public_key: BASE64.encode(public_key.as_bytes()),
        private_key: BASE64.encode(private_key.as_bytes()),
    })
}

// ============================================================================
// PASSWORD HASHING
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordHash {
    pub hash: String,
    pub salt: String,
    pub algorithm: String,
    pub iterations: u32,
}

pub fn hash_password(password: &str) -> Result<PasswordHash> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    
    let hash = argon2.hash_password(password.as_bytes(), &salt)
        .map_err(|e| SecurityError::KeyDerivationFailed(e.to_string()))?;
    
    Ok(PasswordHash {
        hash: hash.to_string(),
        salt: salt.to_string(),
        algorithm: "Argon2id".to_string(),
        iterations: 3,
    })
}

pub fn verify_password(password: &str, hash: &PasswordHash) -> bool {
    let parsed_hash = argon2::PasswordHash::new(&hash.hash)
        .expect("Valid hash format");
    
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

// ============================================================================
// ENCODING UTILITIES
// ============================================================================

pub fn base64_encode(data: &[u8]) -> String {
    BASE64.encode(data)
}

pub fn base64_decode(data: &str) -> Result<Vec<u8>> {
    BASE64.decode(data).map_err(|e| SecurityError::EncodingError(e.to_string()))
}

pub fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn hex_decode(data: &str) -> Result<Vec<u8>> {
    (0..data.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&data[i..i+2], 16)
                .map_err(|e| SecurityError::EncodingError(e.to_string()))
        })
        .collect()
}

// ============================================================================
// CONSTANT-TIME COMPARISON
// ============================================================================

pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

// ============================================================================
// TOKEN GENERATION
// ============================================================================

pub fn generate_api_key() -> Result<String> {
    let random = generate_random_bytes(32)?;
    Ok(format!("tgr_{}", hex_encode(&random)))
}

pub fn generate_jwt_secret() -> Result<[u8; 64]> {
    let mut secret = [0u8; 64];
    OsRng.fill_bytes(&mut secret)
        .map_err(|e| SecurityError::RandomError(e.to_string()))?;
    Ok(secret)
}

pub fn generate_session_token() -> Result<String> {
    let random = generate_random_bytes(32)?;
    Ok(hex_encode(&random))
}

// ============================================================================
// TOTP (Time-based One-Time Password)
// ============================================================================

pub struct TotpGenerator {
    secret: Vec<u8>,
    digits: u32,
    period: u64,
}

impl TotpGenerator {
    pub fn new(secret: &[u8]) -> Self {
        Self { secret: secret.to_vec(), digits: 6, period: 30 }
    }

    pub fn generate(&self) -> String {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() / self.period;
        
        let counter = time.to_be_bytes();
        let hmac = hmac_sha512(&self.secret, &counter);
        
        let offset = (hmac[hmac.len() - 1] & 0x0f) as usize;
        let code = ((hmac[offset] & 0x7f) as u32) << 24
            | (hmac[offset + 1] as u32) << 16
            | (hmac[offset + 2] as u32) << 8
            | (hmac[offset + 3] as u32);
        
        format!("{:0>width$}", code % 10u32.pow(self.digits), width = self.digits as usize)
    }

    pub fn verify(&self, code: &str, window: u64) -> bool {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        for i in 0..=window {
            let check_time = time - (i * self.period);
            let counter = check_time.to_be_bytes();
            let hmac = hmac_sha512(&self.secret, &counter);
            
            let offset = (hmac[hmac.len() - 1] & 0x0f) as usize;
            let expected = ((hmac[offset] & 0x7f) as u32) << 24
                | (hmac[offset + 1] as u32) << 16
                | (hmac[offset + 2] as u32) << 8
                | (hmac[offset + 3] as u32);
            
            let expected_str = format!("{:0>width$}", expected % 10u32.pow(self.digits), width = self.digits as usize);
            
            if constant_time_compare(expected_str.as_bytes(), code.as_bytes()) {
                return true;
            }
        }
        false
    }
}

// ============================================================================
// RATE LIMITER
// ============================================================================

#[derive(Debug, Clone)]
pub struct RateLimiter {
    requests: Arc<RwLock<std::collections::HashMap<String, Vec<u64>>>>,
    max_requests: u32,
    window_ms: u64,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window_ms: u64) -> Self {
        Self {
            requests: Arc::new(RwLock::new(std::collections::HashMap::new())),
            max_requests,
            window_ms,
        }
    }

    pub fn check(&self, key: &str) -> Result<()> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut requests = self.requests.write().unwrap();
        let times = requests.entry(key.to_string()).or_insert_with(Vec::new);
        
        // Remove old requests outside window
        times.retain(|&t| now - t < self.window_ms);
        
        if times.len() >= self.max_requests as usize {
            return Err(SecurityError::RateLimitExceeded);
        }
        
        times.push(now);
        Ok(())
    }
}

// ============================================================================
// ACCESS CONTROL
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permission {
    pub resource: String,
    pub action: String,
}

pub struct AccessControl {
    roles: Arc<RwLock<std::collections::HashMap<String, Vec<Permission>>>>,
    user_roles: Arc<RwLock<std::collections::HashMap<String, Vec<String>>>>,
}

impl AccessControl {
    pub fn new() -> Self {
        Self {
            roles: Arc::new(RwLock::new(std::collections::HashMap::new())),
            user_roles: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    pub fn add_role(&self, role: &str, permissions: Vec<Permission>) {
        let mut roles = self.roles.write().unwrap();
        roles.insert(role.to_string(), permissions);
    }

    pub fn assign_role(&self, user: &str, role: &str) {
        let mut user_roles = self.user_roles.write().unwrap();
        user_roles.entry(user.to_string()).or_insert_with(Vec::new).push(role.to_string());
    }

    pub fn check(&self, user: &str, resource: &str, action: &str) -> Result<()> {
        let user_roles = self.user_roles.read().unwrap();
        let roles = self.roles.read().unwrap();
        
        if let Some(user_role_list) = user_roles.get(user) {
            for role_name in user_role_list {
                if let Some(perms) = roles.get(role_name) {
                    for perm in perms {
                        if (perm.resource == "*" || perm.resource == resource) 
                            && (perm.action == "*" || perm.action == action) {
                            return Ok(());
                        }
                    }
                }
            }
        }
        
        Err(SecurityError::AccessDenied(format!("User {} cannot {} {}", user, action, resource)))
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hmac() {
        let key = b"test_key";
        let message = b"test_message";
        let result = hmac_sha256(key, message);
        assert_eq!(result.len(), 32);
    }

    #[test]
    fn test_aes_encryption() {
        let key = generate_aes_key().unwrap();
        let encryptor = AesEncryptor::new(&key);
        
        let plaintext = b"Hello, TigerEx!";
        let encrypted = encryptor.encrypt(plaintext).unwrap();
        let decrypted = encryptor.decrypt(&encrypted).unwrap();
        
        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_password_hashing() {
        let password = "secure_password_123";
        let hash = hash_password(password).unwrap();
        assert!(verify_password(password, &hash));
        assert!(!verify_password("wrong_password", &hash));
    }

    #[test]
    fn test_totp() {
        let secret = generate_random_bytes(16).unwrap();
        let totp = TotpGenerator::new(&secret);
        
        let code = totp.generate();
        assert_eq!(code.len(), 6);
        assert!(totp.verify(&code, 1));
    }

    #[test]
    fn test_rate_limiter() {
        let limiter = RateLimiter::new(3, 60000);
        
        assert!(limiter.check("user1").is_ok());
        assert!(limiter.check("user1").is_ok());
        assert!(limiter.check("user1").is_ok());
        assert!(limiter.check("user1").is_err());
    }

    #[test]
    fn test_access_control() {
        let ac = AccessControl::new();
        
        ac.add_role("admin", vec![
            Permission { resource: "*".to_string(), action: "*".to_string() }
        ]);
        
        ac.assign_role("user1", "admin");
        
        assert!(ac.check("user1", "users", "read").is_ok());
        assert!(ac.check("user1", "users", "delete").is_ok());
        assert!(ac.check("user2", "users", "delete").is_err());
    }
}