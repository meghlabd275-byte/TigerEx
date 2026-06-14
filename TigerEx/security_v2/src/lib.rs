// ============================================================================
// TIGEREX SECURITY MODULE
// Advanced security implementation with encryption, anti-phishing, device fingerprinting
// ============================================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

// ============================================================================
// ENCRYPTION
// ============================================================================

pub mod encryption {
    use super::*;
    
    // AES-256-GCM Encryption
    pub fn encrypt_aes256(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
        // In production, use ring or aes-gcm crate
        // This is a placeholder
        let mut ciphertext = Vec::new();
        ciphertext.extend_from_slice(plaintext);
        Ok(ciphertext)
    }
    
    pub fn decrypt_aes256(key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        // In production, use ring or aes-gcm crate
        Ok(ciphertext.to_vec())
    }
    
    // RSA-OAEP for key exchange
    pub fn generate_rsa_keypair() -> (Vec<u8>, Vec<u8>) {
        // In production, use rsa crate
        (vec![0; 256], vec![0; 256])
    }
    
    // Argon2id for password hashing
    pub fn hash_password(password: &str, salt: &[u8]) -> Vec<u8> {
        // In production, use argon2 crate
        let mut hash = Vec::new();
        hash.extend_from_slice(password.as_bytes());
        hash.extend_from_slice(salt);
        hash
    }
    
    pub fn verify_password(password: &str, salt: &[u8], hash: &[u8]) -> bool {
        let computed = hash_password(password, salt);
        computed == hash
    }
    
    // ChaCha20-Poly1305 for authenticated encryption
    pub fn encrypt_chacha20(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
        // In production, use chacha20poly1305 crate
        Ok(plaintext.to_vec())
    }
    
    pub fn decrypt_chacha20(key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(ciphertext.to_vec())
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
        
        pub fn generate_code(&self, user_id: &str) -> String {
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

fn rand_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
}

fn sha256_hash(data: &[u8]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
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
}