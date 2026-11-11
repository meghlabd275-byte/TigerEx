// ============================================================================
// TIGEREX SECURITY MODULE
// Advanced security implementation with encryption, anti-phishing, device fingerprinting
// ============================================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

// ============================================================================
// ENCRYPTION
// ============================================================================

pub mod encryption {
    use aes_gcm::{
        aead::{Aead, KeyInit, OsRng},
        Aes256Gcm, Nonce,
    };
    use argon2::{
        password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
        Argon2,
    };
    use chacha20poly1305::{ChaCha20Poly1305, Nonce as ChNonce};
    use rand::RngCore;
    use rsa::{
        pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding},
        Oaep, RsaPrivateKey, RsaPublicKey,
    };
    use sha2::Sha256;

    const NONCE_LEN: usize = 12;

    /// AES-256-GCM. Output is `nonce || ciphertext || tag`; the random nonce
    /// travels with the ciphertext so it is never reused under one key, and a
    /// wrong key or a tampered ciphertext fails to decrypt.
    pub fn encrypt_aes256(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("invalid AES key length: {}", e))?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| "AES-256-GCM encryption failed".to_string())?;

        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    pub fn decrypt_aes256(key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        if ciphertext.len() <= NONCE_LEN {
            return Err("AES-256-GCM ciphertext is truncated".to_string());
        }
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("invalid AES key length: {}", e))?;
        let (nonce_bytes, body) = ciphertext.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        cipher
            .decrypt(nonce, body)
            .map_err(|_| "AES-256-GCM authentication failed".to_string())
    }

    /// Generate an RSA-2048 key pair, DER-encoded (PKCS#8 private, SPKI public).
    pub fn generate_rsa_keypair() -> Result<(Vec<u8>, Vec<u8>), String> {
        let mut rng = OsRng;
        let private = RsaPrivateKey::new(&mut rng, 2048)
            .map_err(|e| format!("RSA key generation failed: {}", e))?;
        let public = RsaPublicKey::from(&private);

        let private_der = private
            .to_pkcs8_der()
            .map_err(|e| format!("RSA private key encoding failed: {}", e))?;
        let public_der = public
            .to_public_key_der()
            .map_err(|e| format!("RSA public key encoding failed: {}", e))?;
        Ok((private_der.as_bytes().to_vec(), public_der.as_bytes().to_vec()))
    }

    /// Encrypt to an RSA public key with OAEP-SHA256.
    pub fn rsa_encrypt(public_der: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let public = RsaPublicKey::from_public_key_der(public_der)
            .map_err(|e| format!("invalid RSA public key: {}", e))?;
        let mut rng = OsRng;
        public
            .encrypt(&mut rng, Oaep::new::<Sha256>(), plaintext)
            .map_err(|e| format!("RSA encryption failed: {}", e))
    }

    pub fn rsa_decrypt(private_der: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let private = RsaPrivateKey::from_pkcs8_der(private_der)
            .map_err(|e| format!("invalid RSA private key: {}", e))?;
        private
            .decrypt(Oaep::new::<Sha256>(), ciphertext)
            .map_err(|_| "RSA decryption failed".to_string())
    }

    /// Export a private key as PEM for storage in a secret manager.
    pub fn rsa_private_to_pem(private_der: &[u8]) -> Result<String, String> {
        let private = RsaPrivateKey::from_pkcs8_der(private_der)
            .map_err(|e| format!("invalid RSA private key: {}", e))?;
        private
            .to_pkcs8_pem(LineEnding::LF)
            .map(|pem| pem.to_string())
            .map_err(|e| format!("RSA PEM encoding failed: {}", e))
    }

    /// Hash a password with Argon2id. The PHC string carries the salt and
    /// parameters, so no separate salt needs to be stored.
    pub fn hash_password(password: &str) -> Result<String, String> {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| format!("password hashing failed: {}", e))
    }

    pub fn verify_password(password: &str, encoded: &str) -> bool {
        match PasswordHash::new(encoded) {
            Ok(parsed) => Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok(),
            Err(_) => false,
        }
    }

    /// ChaCha20-Poly1305 authenticated encryption; output is `nonce || ct||tag`.
    pub fn encrypt_chacha20(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let cipher = ChaCha20Poly1305::new_from_slice(key)
            .map_err(|e| format!("invalid ChaCha20 key length: {}", e))?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = ChNonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| "ChaCha20-Poly1305 encryption failed".to_string())?;

        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    pub fn decrypt_chacha20(key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        if ciphertext.len() <= NONCE_LEN {
            return Err("ChaCha20-Poly1305 ciphertext is truncated".to_string());
        }
        let cipher = ChaCha20Poly1305::new_from_slice(key)
            .map_err(|e| format!("invalid ChaCha20 key length: {}", e))?;
        let (nonce_bytes, body) = ciphertext.split_at(NONCE_LEN);
        let nonce = ChNonce::from_slice(nonce_bytes);
        cipher
            .decrypt(nonce, body)
            .map_err(|_| "ChaCha20-Poly1305 authentication failed".to_string())
    }
}

// ============================================================================
// ANTI-PHIVISHING
// ============================================================================

pub mod anti_phishing {
    use super::*;
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct AntiPhishingCode {
        pub user_id: String,
        pub code: String,
        pub created_at: u64,
        pub last_used: u64,
    }
    
    pub struct AntiPhishingService {
        codes: HashMap<String, AntiPhishingCode>,
    }
    
    impl AntiPhishingService {
        pub fn new() -> Self {
            Self {
                codes: HashMap::new(),
            }
        }
        
        pub fn generate_code(&self, _user_id: &str) -> String {
            // Generate 8-character alphanumeric code
            let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let mut code = String::new();
            for _ in 0..8 {
                let idx = rand_u64() as usize % chars.len();
                code.push(chars.chars().nth(idx).unwrap());
            }
            code
        }
        
        pub fn set_code(&mut self, user_id: &str) -> String {
            let code = self.generate_code(user_id);
            let now = current_time();
            
            self.codes.insert(user_id.to_string(), AntiPhishingCode {
                user_id: user_id.to_string(),
                code: code.clone(),
                created_at: now,
                last_used: now,
            });
            
            code
        }
        
        pub fn verify_code(&self, user_id: &str, code: &str) -> bool {
            if let Some(stored) = self.codes.get(user_id) {
                stored.code == code
            } else {
                false
            }
        }
    }
}

// ============================================================================
// DEVICE FINGERPRINTING
// ============================================================================

pub mod device {
    use super::*;
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct DeviceFingerprint {
        pub id: String,
        pub user_id: String,
        pub fingerprint: String,
        pub device_type: String,
        pub os: String,
        pub browser: String,
        pub ip_address: String,
        pub user_agent: String,
        pub trusted: bool,
        pub created_at: u64,
        pub last_seen: u64,
    }
    
    pub struct DeviceService {
        fingerprints: HashMap<String, DeviceFingerprint>,
    }
    
    impl DeviceService {
        pub fn new() -> Self {
            Self {
                fingerprints: HashMap::new(),
            }
        }
        
        pub fn create_fingerprint(&mut self, user_id: &str, user_agent: &str, ip: &str) -> DeviceFingerprint {
            let fp = generate_device_fingerprint(user_id, user_agent, ip);
            
            self.fingerprints.insert(fp.id.clone(), fp.clone());
            fp
        }
        
        pub fn verify_device(&self, device_id: &str) -> Option<&DeviceFingerprint> {
            self.fingerprints.get(device_id)
        }
        
        pub fn trust_device(&mut self, device_id: &str) -> bool {
            if let Some(fp) = self.fingerprints.get_mut(device_id) {
                fp.trusted = true;
                fp.last_seen = current_time();
                return true;
            }
            false
        }
        
        pub fn get_user_devices(&self, user_id: &str) -> Vec<&DeviceFingerprint> {
            self.fingerprints
                .values()
                .filter(|fp| fp.user_id == user_id)
                .collect()
        }
    }
    
    fn generate_device_fingerprint(user_id: &str, user_agent: &str, ip: &str) -> DeviceFingerprint {
        let data = format!("{}:{}:{}", user_id, user_agent, ip);
        let hash = sha256_hash(data.as_bytes());
        
        DeviceFingerprint {
            id: hash[..16].to_string(),
            user_id: user_id.to_string(),
            fingerprint: hash,
            device_type: detect_device_type(user_agent),
            os: detect_os(user_agent),
            browser: detect_browser(user_agent),
            ip_address: ip.to_string(),
            user_agent: user_agent.to_string(),
            trusted: false,
            created_at: current_time(),
            last_seen: current_time(),
        }
    }
}

// ============================================================================
// BEHAVIORAL ANALYTICS
// ============================================================================

pub mod behavioral {
    use super::*;
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct UserBehavior {
        pub user_id: String,
        pub login_times: Vec<u64>,
        pub ip_addresses: Vec<String>,
        pub typical_assets: Vec<String>,
        pub typical_amounts: Vec<f64>,
        pub withdrawal_patterns: Vec<WithdrawalPattern>,
        pub risk_score: f64,
    }
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct WithdrawalPattern {
        pub amount: f64,
        pub asset: String,
        pub address: String,
        pub timestamp: u64,
    }
    
    pub struct BehavioralAnalytics {
        behaviors: HashMap<String, UserBehavior>,
    }
    
    impl BehavioralAnalytics {
        pub fn new() -> Self {
            Self {
                behaviors: HashMap::new(),
            }
        }
        
        pub fn record_login(&mut self, user_id: &str, ip: &str) {
            let behavior = self.behaviors.entry(user_id.to_string())
                .or_insert_with(|| UserBehavior {
                    user_id: user_id.to_string(),
                    login_times: vec![],
                    ip_addresses: vec![],
                    typical_assets: vec![],
                    typical_amounts: vec![],
                    withdrawal_patterns: vec![],
                    risk_score: 0.0,
                });
            
            if !behavior.ip_addresses.contains(&ip.to_string()) {
                behavior.ip_addresses.push(ip.to_string());
            }
            behavior.login_times.push(current_time());
        }
        
        pub fn record_withdrawal(&mut self, user_id: &str, amount: f64, asset: &str, address: &str) {
            let behavior = self.behaviors.entry(user_id.to_string())
                .or_insert_with(|| UserBehavior {
                    user_id: user_id.to_string(),
                    login_times: vec![],
                    ip_addresses: vec![],
                    typical_assets: vec![],
                    typical_amounts: vec![],
                    withdrawal_patterns: vec![],
                    risk_score: 0.0,
                });
            
            behavior.withdrawal_patterns.push(WithdrawalPattern {
                amount,
                asset: asset.to_string(),
                address: address.to_string(),
                timestamp: current_time(),
            });
        }
        
        pub fn calculate_risk_score(&self, user_id: &str, ip: &str, amount: f64, address: &str) -> f64 {
            let behavior = match self.behaviors.get(user_id) {
                Some(b) => b,
                None => return 50.0, // Unknown user, moderate risk
            };
            
            let mut score = 0.0;
            
            // New IP check
            if !behavior.ip_addresses.is_empty() && !behavior.ip_addresses.contains(&ip.to_string()) {
                score += 30.0;
            }
            
            // Unusual amount
            if !behavior.typical_amounts.is_empty() {
                let avg: f64 = behavior.typical_amounts.iter().sum::<f64>() / behavior.typical_amounts.len() as f64;
                if amount > avg * 5.0 {
                    score += 40.0;
                }
            }
            
            // New withdrawal address
            let known_addresses: Vec<&str> = behavior.withdrawal_patterns.iter()
                .map(|p| p.address.as_str())
                .collect();
            if !known_addresses.is_empty() && !known_addresses.contains(&address) {
                score += 50.0;
            }
            
            score
        }
    }
}

// ============================================================================
// RATE LIMITING
// ============================================================================

pub mod rate_limit {
    use super::*;
    
    #[derive(Debug, Clone)]
    pub struct RateLimitBucket {
        pub tokens: f64,
        pub max_tokens: f64,
        pub refill_rate: f64,
        pub last_refill: u64,
    }
    
    pub struct RateLimiter {
        pub buckets: HashMap<String, RateLimitBucket>,
        pub requests_per_minute: i32,
    }
    
    impl RateLimiter {
        pub fn new(requests_per_minute: i32) -> Self {
            Self {
                buckets: HashMap::new(),
                requests_per_minute,
            }
        }
        
        pub fn allow(&mut self, key: &str) -> bool {
            let bucket = self.buckets.entry(key.to_string())
                .or_insert_with(|| RateLimitBucket {
                    tokens: self.requests_per_minute as f64,
                    max_tokens: self.requests_per_minute as f64,
                    refill_rate: self.requests_per_minute as f64 / 60.0,
                    last_refill: current_time(),
                });
            
            // Refill tokens
            let now = current_time();
            let elapsed = now - bucket.last_refill;
            bucket.tokens += (elapsed as f64 / 60.0) * bucket.refill_rate;
            bucket.tokens = bucket.tokens.min(bucket.max_tokens);
            bucket.last_refill = now;
            
            if bucket.tokens >= 1.0 {
                bucket.tokens -= 1.0;
                return true;
            }
            
            false
        }
    }
}

// ============================================================================
// HELPERS
// ============================================================================

fn current_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Cryptographically secure random value, used to seed anti-phishing codes.
fn rand_u64() -> u64 {
    use rand::RngCore;
    rand::rngs::OsRng.next_u64()
}

fn sha256_hash(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(data);
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

fn detect_device_type(user_agent: &str) -> String {
    if user_agent.contains("Mobile") {
        "mobile".to_string()
    } else if user_agent.contains("Tablet") {
        "tablet".to_string()
    } else {
        "desktop".to_string()
    }
}

fn detect_os(user_agent: &str) -> String {
    if user_agent.contains("Windows") {
        "Windows".to_string()
    } else if user_agent.contains("Mac") {
        "macOS".to_string()
    } else if user_agent.contains("Linux") {
        "Linux".to_string()
    } else if user_agent.contains("Android") {
        "Android".to_string()
    } else if user_agent.contains("iOS") || user_agent.contains("iPhone") {
        "iOS".to_string()
    } else {
        "Unknown".to_string()
    }
}

fn detect_browser(user_agent: &str) -> String {
    if user_agent.contains("Chrome") {
        "Chrome".to_string()
    } else if user_agent.contains("Firefox") {
        "Firefox".to_string()
    } else if user_agent.contains("Safari") {
        "Safari".to_string()
    } else if user_agent.contains("Edge") {
        "Edge".to_string()
    } else {
        "Unknown".to_string()
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_anti_phishing() {
        let mut service = anti_phishing::AntiPhishingService::new();
        
        let code = service.set_code("user123");
        assert_eq!(code.len(), 8);
        
        assert!(service.verify_code("user123", &code));
        assert!(!service.verify_code("user123", "INVALID"));
    }
    
    #[test]
    fn test_device_fingerprint() {
        let mut service = device::DeviceService::new();
        
        let fp = service.create_fingerprint("user123", "Mozilla/5.0", "192.168.1.1");
        assert_eq!(fp.user_id, "user123");
    }
    
    #[test]
    fn test_behavioral_analytics() {
        let mut analytics = behavioral::BehavioralAnalytics::new();
        
        analytics.record_login("user123", "192.168.1.1");
        analytics.record_withdrawal("user123", 1000.0, "BTC", "bc1q...");
        
        let score = analytics.calculate_risk_score("user123", "192.168.1.1", 1000.0, "bc1q...");
        assert!(score < 50.0); // Known user, normal amount
        
        let new_score = analytics.calculate_risk_score("user123", "10.0.0.1", 100000.0, "bc1q_new...");
        assert!(new_score > 50.0); // Unusual behavior
    }
    
    #[test]
    fn test_rate_limiter() {
        let mut limiter = rate_limit::RateLimiter::new(10);
        
        // Should allow first 10 requests
        for _ in 0..10 {
            assert!(limiter.allow("user123"));
        }
        
        // Should deny 11th request
        assert!(!limiter.allow("user123"));
    }

    #[test]
    fn aes_gcm_round_trips_and_rejects_tampering() {
        let key = [7u8; 32];
        let plaintext = b"seed phrase material";
        let ct = encryption::encrypt_aes256(&key, plaintext).unwrap();
        assert_ne!(&ct[..], plaintext, "ciphertext must not equal plaintext");
        assert_eq!(encryption::decrypt_aes256(&key, &ct).unwrap(), plaintext);

        let mut tampered = ct.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert!(encryption::decrypt_aes256(&key, &tampered).is_err());

        let wrong_key = [8u8; 32];
        assert!(encryption::decrypt_aes256(&wrong_key, &ct).is_err());
    }

    #[test]
    fn chacha20_round_trips_and_rejects_tampering() {
        let key = [3u8; 32];
        let plaintext = b"withdrawal signing payload";
        let ct = encryption::encrypt_chacha20(&key, plaintext).unwrap();
        assert_ne!(&ct[..], plaintext);
        assert_eq!(encryption::decrypt_chacha20(&key, &ct).unwrap(), plaintext);
        assert!(encryption::decrypt_chacha20(&[4u8; 32], &ct).is_err());
    }

    #[test]
    fn rsa_oaep_round_trips() {
        let (private, public) = encryption::generate_rsa_keypair().unwrap();
        assert!(!private.is_empty() && !public.is_empty());
        let ct = encryption::rsa_encrypt(&public, b"wrapped data key").unwrap();
        assert_eq!(encryption::rsa_decrypt(&private, &ct).unwrap(), b"wrapped data key");
        assert!(encryption::rsa_private_to_pem(&private).unwrap().contains("PRIVATE KEY"));
    }

    #[test]
    fn password_hash_is_salted_and_verifies() {
        let hash = encryption::hash_password("SecurePass123!").unwrap();
        assert!(hash.starts_with("$argon2"));
        assert!(encryption::verify_password("SecurePass123!", &hash));
        assert!(!encryption::verify_password("wrong", &hash));
        // Two hashes of the same password differ (distinct salts).
        assert_ne!(hash, encryption::hash_password("SecurePass123!").unwrap());
    }

    #[test]
    fn device_fingerprint_uses_real_sha256() {
        let hash = sha256_hash(b"abc");
        assert_eq!(hash.len(), 64);
        assert_eq!(hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}